
/**
 * 为箭头按钮添加触摸支持，防止触摸时触发两次（click + touch）
 * @param element 箭头按钮元素
 * @param callback 点击回调
 */
export function addArrowTouchSupport(
    element: HTMLElement,
    callback: (direction: -1 | 1) => void,
    direction: -1 | 1
): void {
    element.addEventListener('touchstart', (e) => {
        e.preventDefault();
        callback(direction);
    });
    element.addEventListener('touchend', (e) => {
        e.preventDefault();
    });
    element.addEventListener('touchcancel', (e) => {
        e.preventDefault();
    });
    element.addEventListener('click', (e) => {
        e.preventDefault();
        callback(direction);
    });
}

/**
 * 为数值控制器添加滑动拖动支持（鼠标 + 触摸）
 * 使用 Pointer Events 按需绑定 document 级监听器，拖动结束后立即移除，避免监听器泄漏
 * @param container 控制器容器元素
 * @param onChange 值变化回调 (delta: 累积移动量)
 * @param onStart 拖动开始回调
 * @param onEnd 拖动结束回调
 * @returns cleanup 函数，调用方可在 dispose 时移除所有监听器
 */
export function addSliderDragSupport(
    container: HTMLElement,
    onChange: (delta: number) => void,
    onStart?: () => void,
    onEnd?: () => void
): () => void {
    let isDragging = false;
    let lastX = 0;
    let lastY = 0;
    let accumulatedDelta = 0;
    const SENSITIVITY = 0.5;

    const handleStart = (clientX: number, clientY: number) => {
        isDragging = true;
        lastX = clientX;
        lastY = clientY;
        accumulatedDelta = 0;
        onStart?.();
    };

    const handleMove = (clientX: number) => {
        if (!isDragging) return;
        const dx = clientX - lastX;
        lastX = clientX;
        accumulatedDelta += dx * SENSITIVITY;
        onChange(accumulatedDelta);
    };

    const handleEnd = () => {
        if (!isDragging) return;
        isDragging = false;
        onEnd?.();
        // 拖动结束后移除 document 级监听器
        document.removeEventListener('pointermove', documentPointermoveHandler);
        document.removeEventListener('pointerup', documentPointerupHandler);
        document.removeEventListener('pointercancel', documentPointerupHandler);
    };

    // document 级监听器：仅在拖动期间存在
    const documentPointermoveHandler = (e: PointerEvent) => {
        if (!isDragging) return;
        e.preventDefault();
        handleMove(e.clientX);
    };
    const documentPointerupHandler = () => {
        handleEnd();
    };

    const pointerdownHandler = (e: PointerEvent) => {
        e.preventDefault();
        handleStart(e.clientX, e.clientY);
        // 拖动开始时添加 document 级监听器
        document.addEventListener('pointermove', documentPointermoveHandler);
        document.addEventListener('pointerup', documentPointerupHandler);
        document.addEventListener('pointercancel', documentPointerupHandler);
    };

    container.addEventListener('pointerdown', pointerdownHandler);

    // 返回 cleanup 函数，供调用方在 dispose 时移除所有监听器
    return () => {
        container.removeEventListener('pointerdown', pointerdownHandler);
        document.removeEventListener('pointermove', documentPointermoveHandler);
        document.removeEventListener('pointerup', documentPointerupHandler);
        document.removeEventListener('pointercancel', documentPointerupHandler);
        isDragging = false;
    };
}
