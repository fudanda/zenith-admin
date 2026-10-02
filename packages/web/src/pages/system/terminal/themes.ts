import type { ITheme } from '@xterm/xterm';
import type { editor } from 'monaco-editor';

/**
 * 终端 / 编辑器统一配色调色板。
 * 一套调色板同时驱动 xterm（{@link toXtermTheme}）与 Monaco（{@link toMonacoTheme}），
 * 保证终端与文件编辑器视觉一致。
 */
export interface TerminalThemeDef {
  id: string;
  name: string;
  type: 'dark' | 'light';
  background: string;
  foreground: string;
  cursor: string;
  selection: string;
  black: string;
  red: string;
  green: string;
  yellow: string;
  blue: string;
  magenta: string;
  cyan: string;
  white: string;
  brightBlack: string;
  brightRed: string;
  brightGreen: string;
  brightYellow: string;
  brightBlue: string;
  brightMagenta: string;
  brightCyan: string;
  brightWhite: string;
}

export const DEFAULT_DARK_THEME_ID = 'catppuccin-mocha';
export const DEFAULT_LIGHT_THEME_ID = 'vscode-light';

export const DEFAULT_FONT_FAMILY =
  '"Cascadia Code", "JetBrains Mono", Menlo, Monaco, "Courier New", monospace';

/** 可选等宽字体预设 */
export const FONT_FAMILY_PRESETS: ReadonlyArray<{ label: string; value: string }> = [
  { label: 'Cascadia Code', value: '"Cascadia Code", "JetBrains Mono", Menlo, Monaco, "Courier New", monospace' },
  { label: 'JetBrains Mono', value: '"JetBrains Mono", "Cascadia Code", Menlo, Monaco, monospace' },
  { label: 'Fira Code', value: '"Fira Code", "Cascadia Code", Menlo, Monaco, monospace' },
  { label: 'Source Code Pro', value: '"Source Code Pro", Menlo, Monaco, monospace' },
  { label: 'Consolas', value: 'Consolas, "Courier New", monospace' },
  { label: 'Menlo / Monaco', value: 'Menlo, Monaco, "Courier New", monospace' },
  { label: '系统等宽', value: 'ui-monospace, SFMono-Regular, "Courier New", monospace' },
];

export const TERMINAL_THEMES: readonly TerminalThemeDef[] = [
  // ---------- 暗色 ----------
  {
    id: 'catppuccin-mocha', name: 'Catppuccin Mocha', type: 'dark',
    background: '#1e1e2e', foreground: '#cdd6f4', cursor: '#f5e0dc', selection: '#585b70',
    black: '#45475a', red: '#f38ba8', green: '#a6e3a1', yellow: '#f9e2af',
    blue: '#89b4fa', magenta: '#f5c2e7', cyan: '#94e2d5', white: '#bac2de',
    brightBlack: '#585b70', brightRed: '#f38ba8', brightGreen: '#a6e3a1', brightYellow: '#f9e2af',
    brightBlue: '#89b4fa', brightMagenta: '#f5c2e7', brightCyan: '#94e2d5', brightWhite: '#a6adc8',
  },
  {
    id: 'vscode-dark', name: 'VS Code Dark', type: 'dark',
    background: '#1e1e1e', foreground: '#d4d4d4', cursor: '#aeafad', selection: '#264f78',
    black: '#000000', red: '#cd3131', green: '#0dbc79', yellow: '#e5e510',
    blue: '#2472c8', magenta: '#bc3fbc', cyan: '#11a8cd', white: '#e5e5e5',
    brightBlack: '#666666', brightRed: '#f14c4c', brightGreen: '#23d18b', brightYellow: '#f5f543',
    brightBlue: '#3b8eea', brightMagenta: '#d670d6', brightCyan: '#29b8db', brightWhite: '#ffffff',
  },
  {
    id: 'dracula', name: 'Dracula', type: 'dark',
    background: '#282a36', foreground: '#f8f8f2', cursor: '#f8f8f2', selection: '#44475a',
    black: '#21222c', red: '#ff5555', green: '#50fa7b', yellow: '#f1fa8c',
    blue: '#bd93f9', magenta: '#ff79c6', cyan: '#8be9fd', white: '#f8f8f2',
    brightBlack: '#6272a4', brightRed: '#ff6e6e', brightGreen: '#69ff94', brightYellow: '#ffffa5',
    brightBlue: '#d6acff', brightMagenta: '#ff92df', brightCyan: '#a4ffff', brightWhite: '#ffffff',
  },
  {
    id: 'one-dark', name: 'One Dark', type: 'dark',
    background: '#282c34', foreground: '#abb2bf', cursor: '#528bff', selection: '#3e4451',
    black: '#282c34', red: '#e06c75', green: '#98c379', yellow: '#e5c07b',
    blue: '#61afef', magenta: '#c678dd', cyan: '#56b6c2', white: '#abb2bf',
    brightBlack: '#5c6370', brightRed: '#e06c75', brightGreen: '#98c379', brightYellow: '#e5c07b',
    brightBlue: '#61afef', brightMagenta: '#c678dd', brightCyan: '#56b6c2', brightWhite: '#ffffff',
  },
  {
    id: 'solarized-dark', name: 'Solarized Dark', type: 'dark',
    background: '#002b36', foreground: '#839496', cursor: '#93a1a1', selection: '#073642',
    black: '#073642', red: '#dc322f', green: '#859900', yellow: '#b58900',
    blue: '#268bd2', magenta: '#d33682', cyan: '#2aa198', white: '#eee8d5',
    brightBlack: '#586e75', brightRed: '#cb4b16', brightGreen: '#586e75', brightYellow: '#657b83',
    brightBlue: '#839496', brightMagenta: '#6c71c4', brightCyan: '#93a1a1', brightWhite: '#fdf6e3',
  },
  {
    id: 'github-dark', name: 'GitHub Dark', type: 'dark',
    background: '#0d1117', foreground: '#c9d1d9', cursor: '#c9d1d9', selection: '#163356',
    black: '#484f58', red: '#ff7b72', green: '#3fb950', yellow: '#d29922',
    blue: '#58a6ff', magenta: '#bc8cff', cyan: '#39c5cf', white: '#b1bac4',
    brightBlack: '#6e7681', brightRed: '#ffa198', brightGreen: '#56d364', brightYellow: '#e3b341',
    brightBlue: '#79c0ff', brightMagenta: '#d2a8ff', brightCyan: '#56d4dd', brightWhite: '#f0f6fc',
  },
  {
    id: 'nord', name: 'Nord', type: 'dark',
    background: '#2e3440', foreground: '#d8dee9', cursor: '#d8dee9', selection: '#434c5e',
    black: '#3b4252', red: '#bf616a', green: '#a3be8c', yellow: '#ebcb8b',
    blue: '#81a1c1', magenta: '#b48ead', cyan: '#88c0d0', white: '#e5e9f0',
    brightBlack: '#4c566a', brightRed: '#bf616a', brightGreen: '#a3be8c', brightYellow: '#ebcb8b',
    brightBlue: '#81a1c1', brightMagenta: '#b48ead', brightCyan: '#8fbcbb', brightWhite: '#eceff4',
  },
  {
    id: 'monokai', name: 'Monokai', type: 'dark',
    background: '#272822', foreground: '#f8f8f2', cursor: '#f8f8f0', selection: '#49483e',
    black: '#272822', red: '#f92672', green: '#a6e22e', yellow: '#f4bf75',
    blue: '#66d9ef', magenta: '#ae81ff', cyan: '#a1efe4', white: '#f8f8f2',
    brightBlack: '#75715e', brightRed: '#f92672', brightGreen: '#a6e22e', brightYellow: '#f4bf75',
    brightBlue: '#66d9ef', brightMagenta: '#ae81ff', brightCyan: '#a1efe4', brightWhite: '#f9f8f5',
  },
  {
    id: 'tokyo-night', name: 'Tokyo Night', type: 'dark',
    background: '#1a1b26', foreground: '#a9b1d6', cursor: '#c0caf5', selection: '#33467c',
    black: '#15161e', red: '#f7768e', green: '#9ece6a', yellow: '#e0af68',
    blue: '#7aa2f7', magenta: '#bb9af7', cyan: '#7dcfff', white: '#a9b1d6',
    brightBlack: '#414868', brightRed: '#f7768e', brightGreen: '#9ece6a', brightYellow: '#e0af68',
    brightBlue: '#7aa2f7', brightMagenta: '#bb9af7', brightCyan: '#7dcfff', brightWhite: '#c0caf5',
  },
  {
    id: 'gruvbox-dark', name: 'Gruvbox Dark', type: 'dark',
    background: '#282828', foreground: '#ebdbb2', cursor: '#ebdbb2', selection: '#504945',
    black: '#282828', red: '#cc241d', green: '#98971a', yellow: '#d79921',
    blue: '#458588', magenta: '#b16286', cyan: '#689d6a', white: '#a89984',
    brightBlack: '#928374', brightRed: '#fb4934', brightGreen: '#b8bb26', brightYellow: '#fabd2f',
    brightBlue: '#83a598', brightMagenta: '#d3869b', brightCyan: '#8ec07c', brightWhite: '#ebdbb2',
  },
  {
    id: 'night-owl', name: 'Night Owl', type: 'dark',
    background: '#011627', foreground: '#d6deeb', cursor: '#80a4c2', selection: '#1d3b53',
    black: '#011627', red: '#ef5350', green: '#22da6e', yellow: '#c5e478',
    blue: '#82aaff', magenta: '#c792ea', cyan: '#21c7a8', white: '#ffffff',
    brightBlack: '#575656', brightRed: '#ef5350', brightGreen: '#22da6e', brightYellow: '#ffeb95',
    brightBlue: '#82aaff', brightMagenta: '#c792ea', brightCyan: '#7fdbca', brightWhite: '#ffffff',
  },
  {
    id: 'ayu-dark', name: 'Ayu Dark', type: 'dark',
    background: '#0a0e14', foreground: '#b3b1ad', cursor: '#e6b450', selection: '#273747',
    black: '#01060e', red: '#ea6c73', green: '#91b362', yellow: '#f9af4f',
    blue: '#53bdfa', magenta: '#fae994', cyan: '#90e1c6', white: '#c7c7c7',
    brightBlack: '#686868', brightRed: '#f07178', brightGreen: '#c2d94c', brightYellow: '#ffb454',
    brightBlue: '#59c2ff', brightMagenta: '#ffee99', brightCyan: '#95e6cb', brightWhite: '#ffffff',
  },
  {
    id: 'palenight', name: 'Palenight', type: 'dark',
    background: '#292d3e', foreground: '#a6accd', cursor: '#ffcc00', selection: '#444267',
    black: '#292d3e', red: '#f07178', green: '#c3e88d', yellow: '#ffcb6b',
    blue: '#82aaff', magenta: '#c792ea', cyan: '#89ddff', white: '#d0d0d0',
    brightBlack: '#434758', brightRed: '#ff8b92', brightGreen: '#ddffa7', brightYellow: '#ffe585',
    brightBlue: '#9cc4ff', brightMagenta: '#e1acff', brightCyan: '#a3f7ff', brightWhite: '#ffffff',
  },
  {
    id: 'everforest-dark', name: 'Everforest Dark', type: 'dark',
    background: '#2d353b', foreground: '#d3c6aa', cursor: '#d3c6aa', selection: '#475258',
    black: '#475258', red: '#e67e80', green: '#a7c080', yellow: '#dbbc7f',
    blue: '#7fbbb3', magenta: '#d699b6', cyan: '#83c092', white: '#d3c6aa',
    brightBlack: '#475258', brightRed: '#e67e80', brightGreen: '#a7c080', brightYellow: '#dbbc7f',
    brightBlue: '#7fbbb3', brightMagenta: '#d699b6', brightCyan: '#83c092', brightWhite: '#9da9a0',
  },
  {
    id: 'cobalt2', name: 'Cobalt2', type: 'dark',
    background: '#193549', foreground: '#ffffff', cursor: '#ffc600', selection: '#0050a4',
    black: '#000000', red: '#ff0000', green: '#38de21', yellow: '#ffe50a',
    blue: '#1460d2', magenta: '#ff005d', cyan: '#00bbbb', white: '#bbbbbb',
    brightBlack: '#555555', brightRed: '#f40e17', brightGreen: '#3bd01d', brightYellow: '#edc809',
    brightBlue: '#5555ff', brightMagenta: '#ff55ff', brightCyan: '#6ae3fa', brightWhite: '#ffffff',
  },
  {
    id: 'rose-pine', name: 'Rosé Pine', type: 'dark',
    background: '#191724', foreground: '#e0def4', cursor: '#e0def4', selection: '#403d52',
    black: '#26233a', red: '#eb6f92', green: '#31748f', yellow: '#f6c177',
    blue: '#9ccfd8', magenta: '#c4a7e7', cyan: '#ebbcba', white: '#e0def4',
    brightBlack: '#6e6a86', brightRed: '#eb6f92', brightGreen: '#31748f', brightYellow: '#f6c177',
    brightBlue: '#9ccfd8', brightMagenta: '#c4a7e7', brightCyan: '#ebbcba', brightWhite: '#e0def4',
  },
  {
    id: 'rose-pine-moon', name: 'Rosé Pine Moon', type: 'dark',
    background: '#232136', foreground: '#e0def4', cursor: '#e0def4', selection: '#44415a',
    black: '#393552', red: '#eb6f92', green: '#3e8fb0', yellow: '#f6c177',
    blue: '#9ccfd8', magenta: '#c4a7e7', cyan: '#ea9a97', white: '#e0def4',
    brightBlack: '#6e6a86', brightRed: '#eb6f92', brightGreen: '#3e8fb0', brightYellow: '#f6c177',
    brightBlue: '#9ccfd8', brightMagenta: '#c4a7e7', brightCyan: '#ea9a97', brightWhite: '#e0def4',
  },
  {
    id: 'kanagawa', name: 'Kanagawa Wave', type: 'dark',
    background: '#1f1f28', foreground: '#dcd7ba', cursor: '#c8c093', selection: '#2d4f67',
    black: '#090618', red: '#c34043', green: '#76946a', yellow: '#c0a36e',
    blue: '#7e9cd8', magenta: '#957fb8', cyan: '#6a9589', white: '#c8c093',
    brightBlack: '#727169', brightRed: '#e82424', brightGreen: '#98bb6c', brightYellow: '#e6c384',
    brightBlue: '#7fb4ca', brightMagenta: '#938aa9', brightCyan: '#7aa89f', brightWhite: '#dcd7ba',
  },
  {
    id: 'synthwave-84', name: "Synthwave '84", type: 'dark',
    background: '#262335', foreground: '#ffffff', cursor: '#f92aad', selection: '#463465',
    black: '#262335', red: '#f97e72', green: '#72f1b8', yellow: '#fede5d',
    blue: '#6872ab', magenta: '#f92aad', cyan: '#2ee2fa', white: '#ffffff',
    brightBlack: '#495495', brightRed: '#ff7edb', brightGreen: '#72f1b8', brightYellow: '#fede5d',
    brightBlue: '#6f7ec9', brightMagenta: '#f92aad', brightCyan: '#03edf9', brightWhite: '#ffffff',
  },
  {
    id: 'catppuccin-macchiato', name: 'Catppuccin Macchiato', type: 'dark',
    background: '#24273a', foreground: '#cad3f5', cursor: '#f4dbd6', selection: '#5b6078',
    black: '#494d64', red: '#ed8796', green: '#a6da95', yellow: '#eed49f',
    blue: '#8aadf4', magenta: '#f5bde6', cyan: '#8bd5ca', white: '#b8c0e0',
    brightBlack: '#5b6078', brightRed: '#ed8796', brightGreen: '#a6da95', brightYellow: '#eed49f',
    brightBlue: '#8aadf4', brightMagenta: '#f5bde6', brightCyan: '#8bd5ca', brightWhite: '#a5adcb',
  },
  {
    id: 'catppuccin-frappe', name: 'Catppuccin Frappé', type: 'dark',
    background: '#303446', foreground: '#c6d0f5', cursor: '#f2d5cf', selection: '#626880',
    black: '#51576d', red: '#e78284', green: '#a6d189', yellow: '#e5c890',
    blue: '#8caaee', magenta: '#f4b8e4', cyan: '#81c8be', white: '#b5bfe2',
    brightBlack: '#626880', brightRed: '#e78284', brightGreen: '#a6d189', brightYellow: '#e5c890',
    brightBlue: '#8caaee', brightMagenta: '#f4b8e4', brightCyan: '#81c8be', brightWhite: '#a5adce',
  },
  {
    id: 'tokyo-night-storm', name: 'Tokyo Night Storm', type: 'dark',
    background: '#24283b', foreground: '#c0caf5', cursor: '#c0caf5', selection: '#364a82',
    black: '#1d202f', red: '#f7768e', green: '#9ece6a', yellow: '#e0af68',
    blue: '#7aa2f7', magenta: '#bb9af7', cyan: '#7dcfff', white: '#a9b1d6',
    brightBlack: '#414868', brightRed: '#f7768e', brightGreen: '#9ece6a', brightYellow: '#e0af68',
    brightBlue: '#7aa2f7', brightMagenta: '#bb9af7', brightCyan: '#7dcfff', brightWhite: '#c0caf5',
  },
  {
    id: 'material-dark', name: 'Material Dark', type: 'dark',
    background: '#212121', foreground: '#eeffff', cursor: '#ffcc00', selection: '#546e7a',
    black: '#000000', red: '#f07178', green: '#c3e88d', yellow: '#ffcb6b',
    blue: '#82aaff', magenta: '#c792ea', cyan: '#89ddff', white: '#eeffff',
    brightBlack: '#546e7a', brightRed: '#ff5370', brightGreen: '#c3e88d', brightYellow: '#ffcb6b',
    brightBlue: '#82aaff', brightMagenta: '#c792ea', brightCyan: '#89ddff', brightWhite: '#ffffff',
  },
  {
    id: 'horizon', name: 'Horizon', type: 'dark',
    background: '#1c1e26', foreground: '#d5d8da', cursor: '#d5d8da', selection: '#2e303e',
    black: '#1c1e26', red: '#e95678', green: '#29d398', yellow: '#fab795',
    blue: '#26bbd9', magenta: '#ee64ac', cyan: '#59e1e3', white: '#d5d8da',
    brightBlack: '#6c6f93', brightRed: '#ec6a88', brightGreen: '#3fdaa4', brightYellow: '#fbc3a7',
    brightBlue: '#3fc4de', brightMagenta: '#f075b5', brightCyan: '#6be6e8', brightWhite: '#d5d8da',
  },
  {
    id: 'panda', name: 'Panda', type: 'dark',
    background: '#292a2b', foreground: '#e6e6e6', cursor: '#ff2c6d', selection: '#3c3c3c',
    black: '#292a2b', red: '#ff2c6d', green: '#19f9d8', yellow: '#ffb86c',
    blue: '#45a9f9', magenta: '#ff75b5', cyan: '#6fc1ff', white: '#e6e6e6',
    brightBlack: '#676b79', brightRed: '#ff2c6d', brightGreen: '#19f9d8', brightYellow: '#ffb86c',
    brightBlue: '#45a9f9', brightMagenta: '#ff75b5', brightCyan: '#6fc1ff', brightWhite: '#ffffff',
  },
  {
    id: 'oxocarbon', name: 'Oxocarbon', type: 'dark',
    background: '#161616', foreground: '#f2f4f8', cursor: '#f2f4f8', selection: '#2d2d2d',
    black: '#262626', red: '#ff7eb6', green: '#42be65', yellow: '#ffe97b',
    blue: '#78a9ff', magenta: '#be95ff', cyan: '#82cfff', white: '#dde1e6',
    brightBlack: '#393939', brightRed: '#ff7eb6', brightGreen: '#42be65', brightYellow: '#ffe97b',
    brightBlue: '#78a9ff', brightMagenta: '#be95ff', brightCyan: '#82cfff', brightWhite: '#ffffff',
  },
  {
    id: 'monokai-pro', name: 'Monokai Pro', type: 'dark',
    background: '#2d2a2e', foreground: '#fcfcfa', cursor: '#fcfcfa', selection: '#403e41',
    black: '#403e41', red: '#ff6188', green: '#a9dc76', yellow: '#ffd866',
    blue: '#78dce8', magenta: '#ab9df2', cyan: '#fc9867', white: '#fcfcfa',
    brightBlack: '#727072', brightRed: '#ff6188', brightGreen: '#a9dc76', brightYellow: '#ffd866',
    brightBlue: '#78dce8', brightMagenta: '#ab9df2', brightCyan: '#fc9867', brightWhite: '#fcfcfa',
  },
  {
    id: 'shades-of-purple', name: 'Shades of Purple', type: 'dark',
    background: '#2d2b55', foreground: '#ffffff', cursor: '#ffee80', selection: '#44406e',
    black: '#1e1e3f', red: '#f97583', green: '#3ad900', yellow: '#fad000',
    blue: '#6943ff', magenta: '#ff2c70', cyan: '#80ffea', white: '#a599e9',
    brightBlack: '#696099', brightRed: '#f97583', brightGreen: '#3ad900', brightYellow: '#fad000',
    brightBlue: '#6943ff', brightMagenta: '#ff2c70', brightCyan: '#80ffea', brightWhite: '#ffffff',
  },
  {
    id: 'flexoki-dark', name: 'Flexoki Dark', type: 'dark',
    background: '#100f0f', foreground: '#cecdc3', cursor: '#cecdc3', selection: '#282726',
    black: '#1c1b1a', red: '#d14d41', green: '#879a39', yellow: '#d0a215',
    blue: '#4385be', magenta: '#8b7ec8', cyan: '#3aa99f', white: '#b7b5ac',
    brightBlack: '#403e3c', brightRed: '#d14d41', brightGreen: '#879a39', brightYellow: '#d0a215',
    brightBlue: '#4385be', brightMagenta: '#8b7ec8', brightCyan: '#3aa99f', brightWhite: '#cecdc3',
  },
  {
    id: 'zenburn', name: 'Zenburn', type: 'dark',
    background: '#3f3f3f', foreground: '#dcdccc', cursor: '#dcdccc', selection: '#525252',
    black: '#1e2320', red: '#cc9393', green: '#7f9f7f', yellow: '#d0bf8f',
    blue: '#6ca0a3', magenta: '#dc8cc3', cyan: '#93e0e3', white: '#dcdccc',
    brightBlack: '#709080', brightRed: '#dca3a3', brightGreen: '#c3bf9f', brightYellow: '#f0dfaf',
    brightBlue: '#94bff3', brightMagenta: '#ec93d3', brightCyan: '#bde0f3', brightWhite: '#ffffff',
  },
  // ---------- 亮色 ----------
  {
    id: 'vscode-light', name: 'VS Code Light', type: 'light',
    background: '#ffffff', foreground: '#383a42', cursor: '#000000', selection: '#add6ff',
    black: '#000000', red: '#cd3131', green: '#00bc00', yellow: '#949800',
    blue: '#0451a5', magenta: '#bc05bc', cyan: '#0598bc', white: '#555555',
    brightBlack: '#686868', brightRed: '#cd3131', brightGreen: '#14ce14', brightYellow: '#b5ba00',
    brightBlue: '#0451a5', brightMagenta: '#bc05bc', brightCyan: '#0598bc', brightWhite: '#a5a5a5',
  },
  {
    id: 'catppuccin-latte', name: 'Catppuccin Latte', type: 'light',
    background: '#eff1f5', foreground: '#4c4f69', cursor: '#dc8a78', selection: '#acb0be',
    black: '#5c5f77', red: '#d20f39', green: '#40a02b', yellow: '#df8e1d',
    blue: '#1e66f5', magenta: '#ea76cb', cyan: '#179299', white: '#acb0be',
    brightBlack: '#6c6f85', brightRed: '#d20f39', brightGreen: '#40a02b', brightYellow: '#df8e1d',
    brightBlue: '#1e66f5', brightMagenta: '#ea76cb', brightCyan: '#179299', brightWhite: '#bcc0cc',
  },
  {
    id: 'one-light', name: 'One Light', type: 'light',
    background: '#fafafa', foreground: '#383a42', cursor: '#526fff', selection: '#e5e5e6',
    black: '#383a42', red: '#e45649', green: '#50a14f', yellow: '#c18401',
    blue: '#4078f2', magenta: '#a626a4', cyan: '#0184bc', white: '#fafafa',
    brightBlack: '#a0a1a7', brightRed: '#e45649', brightGreen: '#50a14f', brightYellow: '#c18401',
    brightBlue: '#4078f2', brightMagenta: '#a626a4', brightCyan: '#0184bc', brightWhite: '#ffffff',
  },
  {
    id: 'solarized-light', name: 'Solarized Light', type: 'light',
    background: '#fdf6e3', foreground: '#657b83', cursor: '#586e75', selection: '#eee8d5',
    black: '#073642', red: '#dc322f', green: '#859900', yellow: '#b58900',
    blue: '#268bd2', magenta: '#d33682', cyan: '#2aa198', white: '#eee8d5',
    brightBlack: '#002b36', brightRed: '#cb4b16', brightGreen: '#586e75', brightYellow: '#657b83',
    brightBlue: '#839496', brightMagenta: '#6c71c4', brightCyan: '#93a1a1', brightWhite: '#fdf6e3',
  },
  {
    id: 'github-light', name: 'GitHub Light', type: 'light',
    background: '#ffffff', foreground: '#24292f', cursor: '#24292f', selection: '#add6ff',
    black: '#24292f', red: '#cf222e', green: '#116329', yellow: '#4d2d00',
    blue: '#0969da', magenta: '#8250df', cyan: '#1b7c83', white: '#6e7781',
    brightBlack: '#57606a', brightRed: '#a40e26', brightGreen: '#1a7f37', brightYellow: '#633c01',
    brightBlue: '#218bff', brightMagenta: '#a475f9', brightCyan: '#3192aa', brightWhite: '#8c959f',
  },
  {
    id: 'gruvbox-light', name: 'Gruvbox Light', type: 'light',
    background: '#fbf1c7', foreground: '#3c3836', cursor: '#3c3836', selection: '#d5c4a1',
    black: '#fbf1c7', red: '#cc241d', green: '#98971a', yellow: '#d79921',
    blue: '#458588', magenta: '#b16286', cyan: '#689d6a', white: '#7c6f64',
    brightBlack: '#928374', brightRed: '#9d0006', brightGreen: '#79740e', brightYellow: '#b57614',
    brightBlue: '#076678', brightMagenta: '#8f3f71', brightCyan: '#427b58', brightWhite: '#3c3836',
  },
  {
    id: 'ayu-light', name: 'Ayu Light', type: 'light',
    background: '#fafafa', foreground: '#5c6166', cursor: '#ff9940', selection: '#d1e4f4',
    black: '#000000', red: '#ea6c73', green: '#6cbf43', yellow: '#eca944',
    blue: '#3199e1', magenta: '#9e75c7', cyan: '#46ba94', white: '#c7c7c7',
    brightBlack: '#686868', brightRed: '#f07178', brightGreen: '#86b300', brightYellow: '#f2ae49',
    brightBlue: '#399ee6', brightMagenta: '#a37acc', brightCyan: '#4cbf99', brightWhite: '#d1d1d1',
  },
  {
    id: 'everforest-light', name: 'Everforest Light', type: 'light',
    background: '#fdf6e3', foreground: '#5c6a72', cursor: '#5c6a72', selection: '#edeada',
    black: '#5c6a72', red: '#f85552', green: '#8da101', yellow: '#dfa000',
    blue: '#3a94c5', magenta: '#df69ba', cyan: '#35a77c', white: '#e0dcc7',
    brightBlack: '#939f91', brightRed: '#f85552', brightGreen: '#8da101', brightYellow: '#dfa000',
    brightBlue: '#3a94c5', brightMagenta: '#df69ba', brightCyan: '#35a77c', brightWhite: '#5c6a72',
  },
  {
    id: 'rose-pine-dawn', name: 'Rosé Pine Dawn', type: 'light',
    background: '#faf4ed', foreground: '#575279', cursor: '#575279', selection: '#dfdad9',
    black: '#f2e9e1', red: '#b4637a', green: '#286983', yellow: '#ea9d34',
    blue: '#56949f', magenta: '#907aa9', cyan: '#d7827e', white: '#575279',
    brightBlack: '#9893a5', brightRed: '#b4637a', brightGreen: '#286983', brightYellow: '#ea9d34',
    brightBlue: '#56949f', brightMagenta: '#907aa9', brightCyan: '#d7827e', brightWhite: '#575279',
  },
  {
    id: 'kanagawa-lotus', name: 'Kanagawa Lotus', type: 'light',
    background: '#f2ecbc', foreground: '#545464', cursor: '#43436c', selection: '#9fb5c9',
    black: '#1f1f28', red: '#c84053', green: '#6f894e', yellow: '#77713f',
    blue: '#4d699b', magenta: '#b35b79', cyan: '#597b75', white: '#717c7c',
    brightBlack: '#282831', brightRed: '#d7474b', brightGreen: '#6e915f', brightYellow: '#836f4a',
    brightBlue: '#6693bf', brightMagenta: '#624c83', brightCyan: '#5e857a', brightWhite: '#545464',
  },
  {
    id: 'tokyo-day', name: 'Tokyo Day', type: 'light',
    background: '#e1e2e7', foreground: '#3760bf', cursor: '#3760bf', selection: '#b6bfe2',
    black: '#b4b5b9', red: '#f52a65', green: '#587539', yellow: '#8c6c3e',
    blue: '#2e7de9', magenta: '#9854f1', cyan: '#007197', white: '#848cb5',
    brightBlack: '#9699a3', brightRed: '#f52a65', brightGreen: '#587539', brightYellow: '#8c6c3e',
    brightBlue: '#2e7de9', brightMagenta: '#9854f1', brightCyan: '#007197', brightWhite: '#3760bf',
  },
  {
    id: 'material-light', name: 'Material Light', type: 'light',
    background: '#fafafa', foreground: '#546e7a', cursor: '#272727', selection: '#80cbc4',
    black: '#000000', red: '#e53935', green: '#91b859', yellow: '#e2931d',
    blue: '#6182b8', magenta: '#9c3eda', cyan: '#39adb5', white: '#a0a0a0',
    brightBlack: '#5f6c72', brightRed: '#ff5370', brightGreen: '#91b859', brightYellow: '#ffb62c',
    brightBlue: '#6182b8', brightMagenta: '#9c3eda', brightCyan: '#39adb5', brightWhite: '#ffffff',
  },
  {
    id: 'flexoki-light', name: 'Flexoki Light', type: 'light',
    background: '#fffcf0', foreground: '#100f0f', cursor: '#100f0f', selection: '#e6e4d9',
    black: '#100f0f', red: '#af3029', green: '#66800b', yellow: '#ad8301',
    blue: '#205ea6', magenta: '#5e409d', cyan: '#24837b', white: '#b7b5ac',
    brightBlack: '#6f6e69', brightRed: '#d14d41', brightGreen: '#879a39', brightYellow: '#d0a215',
    brightBlue: '#4385be', brightMagenta: '#8b7ec8', brightCyan: '#3aa99f', brightWhite: '#fffcf0',
  },
  {
    id: 'pencil-light', name: 'Pencil Light', type: 'light',
    background: '#f1f1f1', foreground: '#424242', cursor: '#424242', selection: '#b9d4f4',
    black: '#212121', red: '#c30771', green: '#10a778', yellow: '#a89c14',
    blue: '#008ec4', magenta: '#523c79', cyan: '#20a5ba', white: '#d9d9d9',
    brightBlack: '#424242', brightRed: '#fb007a', brightGreen: '#5fd7a7', brightYellow: '#f3e430',
    brightBlue: '#20bbfc', brightMagenta: '#6855de', brightCyan: '#4fb8cc', brightWhite: '#f1f1f1',
  },
];

export const DARK_THEMES = TERMINAL_THEMES.filter((t) => t.type === 'dark');
export const LIGHT_THEMES = TERMINAL_THEMES.filter((t) => t.type === 'light');

export function getThemeById(id: string | undefined): TerminalThemeDef | undefined {
  return TERMINAL_THEMES.find((t) => t.id === id);
}

/** 按 id 解析主题，找不到时回退到对应明暗模式的默认主题。 */
export function resolveTheme(id: string | undefined, type: 'dark' | 'light'): TerminalThemeDef {
  return (
    getThemeById(id) ??
    getThemeById(type === 'dark' ? DEFAULT_DARK_THEME_ID : DEFAULT_LIGHT_THEME_ID) ??
    TERMINAL_THEMES[0]
  );
}

/** 调色板 → xterm ITheme */
export function toXtermTheme(t: TerminalThemeDef): ITheme {
  return {
    background: t.background,
    foreground: t.foreground,
    cursor: t.cursor,
    cursorAccent: t.background,
    selectionBackground: t.selection,
    black: t.black,
    red: t.red,
    green: t.green,
    yellow: t.yellow,
    blue: t.blue,
    magenta: t.magenta,
    cyan: t.cyan,
    white: t.white,
    brightBlack: t.brightBlack,
    brightRed: t.brightRed,
    brightGreen: t.brightGreen,
    brightYellow: t.brightYellow,
    brightBlue: t.brightBlue,
    brightMagenta: t.brightMagenta,
    brightCyan: t.brightCyan,
    brightWhite: t.brightWhite,
  };
}

const strip = (hex: string): string => hex.replace('#', '');

/** Monaco 注册主题时使用的唯一名称 */
export function monacoThemeName(t: TerminalThemeDef): string {
  return `arcbase-term-${t.id}`;
}

/**
 * 调色板 → Monaco 主题数据。
 * 背景/前景/光标/选区与终端完全一致，语法高亮 token 用调色板做近似映射。
 */
export function toMonacoTheme(t: TerminalThemeDef): editor.IStandaloneThemeData {
  const base: editor.BuiltinTheme = t.type === 'dark' ? 'vs-dark' : 'vs';
  return {
    base,
    inherit: true,
    rules: [
      { token: '', foreground: strip(t.foreground), background: strip(t.background) },
      { token: 'comment', foreground: strip(t.brightBlack), fontStyle: 'italic' },
      { token: 'keyword', foreground: strip(t.magenta) },
      { token: 'string', foreground: strip(t.green) },
      { token: 'number', foreground: strip(t.yellow) },
      { token: 'regexp', foreground: strip(t.cyan) },
      { token: 'type', foreground: strip(t.cyan) },
      { token: 'type.identifier', foreground: strip(t.cyan) },
      { token: 'function', foreground: strip(t.blue) },
      { token: 'variable', foreground: strip(t.foreground) },
      { token: 'variable.predefined', foreground: strip(t.red) },
      { token: 'constant', foreground: strip(t.yellow) },
      { token: 'operator', foreground: strip(t.cyan) },
      { token: 'delimiter', foreground: strip(t.foreground) },
      { token: 'tag', foreground: strip(t.red) },
      { token: 'attribute.name', foreground: strip(t.yellow) },
      { token: 'attribute.value', foreground: strip(t.green) },
      { token: 'key', foreground: strip(t.blue) },
    ],
    colors: {
      'editor.background': t.background,
      'editor.foreground': t.foreground,
      'editorCursor.foreground': t.cursor,
      'editor.selectionBackground': t.selection,
      'editor.selectionHighlightBackground': t.selection,
      'editorLineNumber.foreground': t.brightBlack,
      'editorLineNumber.activeForeground': t.foreground,
      'editorIndentGuide.background': t.brightBlack,
      'editorWhitespace.foreground': t.brightBlack,
      'editorWidget.background': t.background,
      'editorWidget.foreground': t.foreground,
      'editorSuggestWidget.background': t.background,
      'input.background': t.background,
      'dropdown.background': t.background,
    },
  };
}
