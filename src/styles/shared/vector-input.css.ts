
export const vectorInputStyles = `
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
        flex: 1;
        display: flex;
        flex-direction: column;
        gap: 4px;
    }

    .mp-vector-comp-label {
        font-size: 11px;
        font-weight: 600;
        text-align: center;
    }

    .mp-vector-comp-label[data-axis="x"] {
        color: var(--color-axis-x);
    }

    .mp-vector-comp-label[data-axis="y"] {
        color: var(--color-axis-y);
    }

    .mp-vector-comp-label[data-axis="z"] {
        color: var(--color-axis-z);
    }

    .mp-vector-comp-input {
        width: 100%;
        padding: 6px 8px;
        background-color: var(--color-bg);
        border: 1px solid var(--color-border);
        border-radius: var(--radius-sm);
        color: var(--color-text-primary);
        font-size: 12px;
        font-family: monospace;
        text-align: center;
        transition: border-color var(--transition-fast), background-color var(--transition-fast);
        -moz-appearance: textfield;
    }

    .mp-vector-comp-input::-webkit-outer-spin-button,
    .mp-vector-comp-input::-webkit-inner-spin-button {
        -webkit-appearance: none;
        margin: 0;
    }

    .mp-vector-comp-input:focus {
        outline: none;
        border-color: var(--color-accent);
        background-color: var(--color-surface);
    }


`;
