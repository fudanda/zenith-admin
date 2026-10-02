import { createElement, type ComponentType } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { CMS_WIDGET_RENDERER_KEYS, CMS_WIDGET_RENDERER_LABELS } from '@arcbase/shared/cms';
import type { CmsResolvedWidget, CmsWidgetRendererKey, CmsWidgetRendererOption, CmsWidgetType } from '@arcbase/shared/cms';

export interface CmsWidgetRendererProps {
  widget: CmsResolvedWidget;
}

export interface CmsWidgetRendererDefinition {
  label: string;
  component: ComponentType<CmsWidgetRendererProps>;
}

export const CMS_WIDGET_STYLES = `
.cms-widget { margin: 0 0 24px; }
.cms-widget__title { font-size: 18px; font-weight: 700; margin: 0 0 12px; }
.cms-widget__empty { color: var(--text-2); font-size: 14px; padding: 16px 0; }
.cms-widget-sidebar { border: 1px solid var(--border); border-radius: 10px; padding: 16px; background: var(--bg); }
.cms-widget-sidebar__item { padding: 9px 0; border-bottom: 1px solid var(--border); }
.cms-widget-sidebar__item:last-child { border-bottom: 0; }
.cms-widget-sidebar__item a { font-size: 14px; font-weight: 600; }
.cms-widget-sidebar__item p { color: var(--text-2); font-size: 12px; margin: 3px 0 0; }
.cms-widget-sidebar__item time { color: var(--text-2); font-size: 11px; }
.cms-widget-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 14px; }
.cms-widget-grid__item { border: 1px solid var(--border); border-radius: 10px; overflow: hidden; background: var(--bg); }
.cms-widget-grid__item img { width: 100%; aspect-ratio: 16 / 9; object-fit: cover; display: block; }
.cms-widget-grid__body { padding: 12px; }
.cms-widget-grid__body a { font-size: 15px; font-weight: 600; }
.cms-widget-grid__body p { color: var(--text-2); font-size: 12px; margin-top: 5px; }
.cms-widget-carousel { display: flex; gap: 14px; overflow-x: auto; scroll-snap-type: x mandatory; padding-bottom: 8px; }
.cms-widget-carousel__item { min-width: min(78vw, 320px); position: relative; border-radius: 10px; overflow: hidden; scroll-snap-align: start; background: var(--bg-2); }
.cms-widget-carousel__item img { width: 100%; aspect-ratio: 16 / 9; object-fit: cover; display: block; }
.cms-widget-carousel__caption { padding: 12px; font-size: 15px; font-weight: 600; }
`;

function EmptyWidget({ widget }: CmsWidgetRendererProps) {
  return <div className="cms-widget__empty">{widget.name}：暂无可展示条目</div>;
}

function SidebarRenderer({ widget }: CmsWidgetRendererProps) {
  if (widget.items.length === 0) return <EmptyWidget widget={widget} />;
  return (
    <section data-cms-placement="widget" data-cms-block-id={String(widget.id)} data-cms-component-name={widget.name} className="cms-widget cms-widget-sidebar">
      <h2 className="cms-widget__title">{widget.name}</h2>
      {widget.items.map((item) => (
        <div className="cms-widget-sidebar__item" key={item.id}>
          {item.url ? <a href={item.url}>{item.title}</a> : <span>{item.title}</span>}
          {item.summary ? <p>{item.summary}</p> : null}
          {item.displayDate ? <time>{item.displayDate}</time> : null}
        </div>
      ))}
    </section>
  );
}

function GridRenderer({ widget }: CmsWidgetRendererProps) {
  if (widget.items.length === 0) return <EmptyWidget widget={widget} />;
  return (
    <section data-cms-placement="widget" data-cms-block-id={String(widget.id)} data-cms-component-name={widget.name} className="cms-widget">
      <h2 className="cms-widget__title">{widget.name}</h2>
      <div className="cms-widget-grid">
        {widget.items.map((item) => (
          <article className="cms-widget-grid__item" key={item.id}>
            {item.image ? <img src={item.image} alt={item.title} loading="lazy" /> : null}
            <div className="cms-widget-grid__body">
              {item.url ? <a href={item.url}>{item.title}</a> : <span>{item.title}</span>}
              {item.summary ? <p>{item.summary}</p> : null}
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

function CarouselRenderer({ widget }: CmsWidgetRendererProps) {
  if (widget.items.length === 0) return <EmptyWidget widget={widget} />;
  return (
    <section data-cms-placement="widget" data-cms-block-id={String(widget.id)} data-cms-component-name={widget.name} className="cms-widget">
      <h2 className="cms-widget__title">{widget.name}</h2>
      <div className="cms-widget-carousel">
        {widget.items.map((item) => (
          <article className="cms-widget-carousel__item" key={item.id}>
            {item.url ? (
              <a href={item.url}>
                {item.image ? <img src={item.image} alt={item.title} loading="lazy" /> : null}
                <div className="cms-widget-carousel__caption">{item.title}</div>
              </a>
            ) : (
              <>
                {item.image ? <img src={item.image} alt={item.title} loading="lazy" /> : null}
                <div className="cms-widget-carousel__caption">{item.title}</div>
              </>
            )}
          </article>
        ))}
      </div>
    </section>
  );
}

const coreRenderers: Record<CmsWidgetType, Record<CmsWidgetRendererKey, CmsWidgetRendererDefinition>> = {
  'manual-list': {
    'list-sidebar': { label: CMS_WIDGET_RENDERER_LABELS['list-sidebar'], component: SidebarRenderer },
    'list-grid': { label: CMS_WIDGET_RENDERER_LABELS['list-grid'], component: GridRenderer },
    'list-carousel': { label: CMS_WIDGET_RENDERER_LABELS['list-carousel'], component: CarouselRenderer },
  },
};

export function listCoreCmsWidgetRenderers(type: CmsWidgetType): CmsWidgetRendererOption[] {
  const renderers = coreRenderers[type];
  return CMS_WIDGET_RENDERER_KEYS
    .filter((key) => renderers[key] != null)
    .map((key) => ({ key, label: renderers[key].label }));
}

export function resolveCoreCmsWidgetRenderer(type: CmsWidgetType, key: CmsWidgetRendererKey): CmsWidgetRendererDefinition | null {
  return coreRenderers[type]?.[key] ?? null;
}

export function renderCmsWidgetHtml(
  widget: CmsResolvedWidget,
  override?: CmsWidgetRendererDefinition | null,
  options?: { includeStyles?: boolean },
): string {
  const definition = override ?? resolveCoreCmsWidgetRenderer(widget.type, widget.rendererKey);
  if (!definition) return '';
  const styles = options?.includeStyles === false ? '' : `<style>${CMS_WIDGET_STYLES}</style>`;
  return `${styles}${renderToStaticMarkup(createElement(definition.component, { widget }))}`;
}
