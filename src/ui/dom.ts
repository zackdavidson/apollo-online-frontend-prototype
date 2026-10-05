type Child = Node | string | null | undefined | false;

export interface ElementOptions {
  className?: string;
  text?: string;
  title?: string;
  type?: string;
  value?: string;
  id?: string;
  htmlFor?: string;
  dataset?: Record<string, string>;
  style?: Partial<CSSStyleDeclaration>;
}

/** Tiny element factory to keep the panel code declarative without a framework. */
export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  options: ElementOptions = {},
  children: readonly Child[] = [],
): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag);
  if (options.className) element.className = options.className;
  if (options.text !== undefined) element.textContent = options.text;
  if (options.title) element.title = options.title;
  if (options.id) element.id = options.id;
  if (options.type && element instanceof HTMLInputElement) element.type = options.type;
  if (options.value !== undefined && 'value' in element) (element as HTMLInputElement).value = options.value;
  if (options.htmlFor && element instanceof HTMLLabelElement) element.htmlFor = options.htmlFor;
  if (options.dataset) Object.assign(element.dataset, options.dataset);
  if (options.style) Object.assign(element.style, options.style);
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue;
    element.append(child);
  }
  return element;
}

export function clear(element: HTMLElement): void {
  element.replaceChildren();
}
