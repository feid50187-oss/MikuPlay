
export const sliderStyles = `
    .mp-slider-item {
        display: flex;
        flex-direction: column;
        gap: 4px;
        padding: 6px 0;
    }

    .mp-slider-label-row {
        display: flex;
        align-items: center;
        justify-content: space-between;
    }

    .mp-slider-label {
        font-size: 13px;
        color: var(--color-text-secondary);
    }

    .mp-slider-value {
        font-size: 12px;
        color: var(--color-text-disabled);
        font-variant-numeric: tabular-nums;
    }

    .mp-slider-container {
        position: relative;
    }

    .mp-slider {
        -webkit-appearance: none;
        appearance: none;
        width: 100%;
        height: 4px;
        border-radius: 2px;
        outline: none;
        cursor: pointer;
        touch-action: pan-y;
        /* 轨道区域不参与命中测试：点击/触摸 track 无效（事件直接落空，不跳值） */
        pointer-events: none;
    }

    .mp-slider::-webkit-slider-thumb {
        -webkit-appearance: none;
        appearance: none;
        width: 18px;
        height: 18px;
        border-radius: 50%;
        background: var(--color-accent);
        cursor: pointer;
        transition: transform var(--transition-fast);
        /* 仅 thumb 恢复交互，原生拖动/事件冒泡照常 */
        pointer-events: auto;
        //box-shadow: var(--shadow-sm);
    }

    .mp-slider::-moz-range-thumb {
        width: 18px;
        height: 18px;
        border-radius: 50%;
        background: var(--color-accent);
        cursor: pointer;
        border: none;
        transition: transform var(--transition-fast);
    }


`;
