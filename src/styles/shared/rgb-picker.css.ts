
export const rgbPickerStyles = `
    .mp-rgb-slider-item {
        display: flex;
        align-items: center;
        gap: 8px;
    }

    .mp-rgb-slider-label {
        font-size: 13px;
        font-weight: 600;
        color: var(--color-text-secondary);
        min-width: 14px;
        font-variant-numeric: tabular-nums;
    }

    .mp-rgb-slider-track {
        flex: 1;
        height: 6px;
        border-radius: 3px;
        position: relative;
        cursor: pointer;
    }

    .mp-rgb-slider-track-fill {
        height: 100%;
        border-radius: 3px;
        position: absolute;
        left: 0;
    }

    .mp-rgb-thumb {
        width: 18px;
        height: 18px;
        border-radius: 50%;
        background: #fff;
        border: 2px solid var(--color-border);
        position: absolute;
        top: 50%;
        transform: translate(-50%, -50%);
        cursor: pointer;
        transition: transform 0.15s;
    }
    .mp-vector-input {
        display: flex;
        flex-direction: column;
        gap: 4px;
    }
    .mp-vector-input-label {
        font-size: 13px;
        color: var(--color-text-secondary);
    }
    .mp-vector-input-row {
        display: flex;
        gap: 6px;
    }
    .mp-vector-component {
        display: flex;
        align-items: center;
        gap: 2px;
    }
    .mp-vector-comp-label {
        font-size: 12px;
        font-weight: 600;
        color: var(--color-text-disabled);
        min-width: 12px;
    }
    .mp-vector-comp-input {
        width: 52px;
        padding: 4px 6px;
        border: 1px solid var(--color-border);
        border-radius: 6px;
        font-size: 13px;
        text-align: center;
    }
    .mp-vector-comp-input:focus {
        outline: none;
        border-color: var(--color-accent);
    }
`;
