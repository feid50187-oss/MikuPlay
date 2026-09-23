
export interface IPanel {
  readonly id: string;
  readonly tabLabel: string;
  readonly tabIcon: string;
  readonly element: HTMLElement;
  mount(container: HTMLElement): void;
  unmount(): void;
  dispose(): void;
  onShown?(): void;
  onHidden?(): void;
}
