// 配合折叠动画（grid 0fr → 1fr, 0.3s）的“延迟销毁”工具。
//
// 背景：本项目的折叠/展开使用 CSS grid 高度动画（modelOptPanel.css.ts），
// 动画期间子节点必须仍在 DOM 中，否则高度会瞬间塌缩、看不到过渡。
// 因此“收起”不能直接移除子节点，而要等动画结束（~300ms）后再销毁，
// 以真正减少 DOM 节点数；若延迟期间用户又展开，则取消销毁、保留子节点。

const pendingTimers = new WeakMap<HTMLElement, number>();

/** 取消某个 key 上待执行的延迟销毁（在重新展开时调用）。 */
export function cancelLazyDestroy(key: HTMLElement): void {
    const timer = pendingTimers.get(key);
    if (timer !== undefined) {
        clearTimeout(timer);
        pendingTimers.delete(key);
    }
}

/**
 * 安排一次延迟销毁：delayMs 后调用 onDestroy。
 * 调用前会自动取消同一 key 上已有的待销毁（避免重复）。
 * 调用方应在 onDestroy 内部自行校验“仍处于收起态”，以防竞态。
 */
export function scheduleLazyDestroy(
    key: HTMLElement,
    delayMs: number,
    onDestroy: () => void
): void {
    cancelLazyDestroy(key);
    const timer = window.setTimeout(() => {
        pendingTimers.delete(key);
        onDestroy();
    }, delayMs);
    pendingTimers.set(key, timer);
}
