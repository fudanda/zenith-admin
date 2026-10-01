import { useCallback, useRef, useState } from 'react';
import { z } from 'zod';

/**
 * 登录页专用的轻量受控表单。
 *
 * 登录页静态打包在后台入口的关键路径里，而 Semi `Form`（含 `BaseForm`）静态引入全部字段控件
 * （DatePicker → date-fns、Upload → cropper、Cascader、TreeSelect …，minified ≈ 770 KB / 210 KB gz），
 * 用它就把整套控件拖进匿名首屏。这里用 `Input` + 本地状态实现登录场景需要的「必填 / 格式」校验，
 * 后台页面的表单仍按规范走 Semi `Form` / `EditFormModal`，不要把本文件推广到别处。
 */

export interface FieldRule<T extends Record<string, string>> {
  required?: boolean;
  /** 自定义校验：返回错误文案即失败；格式类校验（邮箱等）复用 shared 契约同源的判定，不写正则 */
  validator?: (value: string, values: T) => string | undefined;
  message: string;
}

export type FieldRules<T extends Record<string, string>> = Partial<Record<keyof T & string, FieldRule<T>[]>>;

type FieldErrors<T extends Record<string, string>> = Partial<Record<keyof T & string, string>>;
type Touched<T extends Record<string, string>> = Partial<Record<keyof T & string, boolean>>;

function validateField<T extends Record<string, string>>(value: string, rules: FieldRule<T>[], values: T): string | undefined {
  for (const rule of rules) {
    if (rule.required && value.trim() === '') return rule.message;
    const custom = rule.validator?.(value, values);
    if (custom) return custom;
  }
  return undefined;
}

/**
 * 行内校验时机（与 Semi Form 的 `trigger: 'change'` 体验对齐）：
 * - 失焦（blur）：校验该字段，首次离开空的必填项即提示；
 * - 输入（change）：已触碰或已出错的字段随每次输入实时重校验，错误在输入合法的瞬间消失；
 *   尚未触碰过的字段输入时不打扰（不会刚敲第一个字符就报格式错）；
 * - 提交：全量校验并把全部字段标为已触碰。
 */
export function useLoginForm<T extends Record<string, string>>(initial: T, rules: FieldRules<T>) {
  const [values, setValues] = useState<T>(initial);
  const [errors, setErrors] = useState<FieldErrors<T>>({});
  const [touched, setTouched] = useState<Touched<T>>({});
  /** 表单级错误（服务端返回的「用户名或密码错误」等），行内显示在字段下方；任何字段再次输入即清除 */
  const [formError, setFormError] = useState<string | null>(null);
  // 三份状态的同步副本：change / blur 回调里按「本次输入后的值」立刻校验，不等下一次渲染；
  // ref 只在各 setter 内与 state 一起更新，不在渲染期写入
  const valuesRef = useRef<T>(initial);
  const touchedRef = useRef<Touched<T>>({});
  const errorsRef = useRef<FieldErrors<T>>({});

  const writeError = useCallback((name: keyof T & string, message: string | undefined) => {
    if (errorsRef.current[name] === message) return;
    errorsRef.current = { ...errorsRef.current, [name]: message };
    setErrors(errorsRef.current);
  }, []);

  /** 按当前值校验单个字段并写入错误；返回是否通过 */
  const validateOne = useCallback((name: keyof T & string, snapshot: T = valuesRef.current): boolean => {
    const message = validateField(snapshot[name] ?? '', rules[name] ?? [], snapshot);
    writeError(name, message);
    return !message;
  }, [rules, writeError]);

  const setValue = useCallback((name: keyof T & string, value: string) => {
    const next = { ...valuesRef.current, [name]: value } as T;
    valuesRef.current = next;
    setValues(next);
    setFormError(null);
    if (touchedRef.current[name] || errorsRef.current[name]) validateOne(name, next);
  }, [validateOne]);

  const touch = useCallback((name: keyof T & string) => {
    if (!touchedRef.current[name]) {
      touchedRef.current = { ...touchedRef.current, [name]: true };
      setTouched(touchedRef.current);
    }
    validateOne(name);
  }, [validateOne]);

  /** 校验全部字段：通过返回当前值，否则写入错误并返回 null */
  const validate = useCallback((): T | null => {
    const snapshot = valuesRef.current;
    const next: FieldErrors<T> = {};
    const all: Touched<T> = { ...touchedRef.current };
    for (const name of Object.keys(rules) as (keyof T & string)[]) {
      all[name] = true;
      const message = validateField(snapshot[name] ?? '', rules[name] ?? [], snapshot);
      if (message) next[name] = message;
    }
    touchedRef.current = all;
    setTouched(all);
    errorsRef.current = next;
    setErrors(next);
    return Object.keys(next).length === 0 ? snapshot : null;
  }, [rules]);

  const reset = useCallback(() => {
    valuesRef.current = initial;
    touchedRef.current = {};
    errorsRef.current = {};
    setValues(initial);
    setErrors({});
    setTouched({});
    setFormError(null);
  }, [initial]);

  /** 展开到 `LoginField`：`{...form.field('username')}` */
  const field = useCallback((name: keyof T & string) => ({
    value: values[name] ?? '',
    onChange: (value: string) => setValue(name, value),
    onBlur: () => touch(name),
    error: errors[name],
  }), [values, errors, setValue, touch]);

  return { values, errors, touched, formError, setFormError, setValue, touch, validate, reset, field };
}

/** 邮箱格式与服务端契约（forgotPasswordSchema 的 z.email()）同一判定，不另写正则 */
const emailSchema = z.email();
export const isEmail = (value: string): boolean => emailSchema.safeParse(value).success;
