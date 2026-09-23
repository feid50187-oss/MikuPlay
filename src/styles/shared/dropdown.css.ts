export const dropdownStyles = `
    .mp-dropdown {
        position: relative;
    }

    .mp-dropdown-item {
        display: flex;
        flex-direction: column;
        gap: 4px;
        padding: 6px 0;
    }

    .mp-dropdown-label {
        font-size: 13px;
        color: var(--color-text-secondary);
    }

    .mp-dropdown-display {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 8px 14px;
        border: 1px solid var(--color-border);
        border-radius: var(--radius-sm);
        background: var(--color-bg);
        cursor: pointer;
        user-select: none;
        transition: border-color var(--transition-fast);
        height: 34px;
    }

    .mp-dropdown.open .mp-dropdown-display {
        border-color: var(--color-accent);
    }

    .mp-dropdown-text {
        font-size: 14px;
        font-weight: 500;
        color: var(--color-text-primary);
    }

    .mp-dropdown-arrow {
        width: 20px;
        height: 20px;
        color: var(--color-accent);
        transition: transform var(--transition-fast);
        flex-shrink: 0;
    }

    .mp-dropdown.open .mp-dropdown-arrow {
        transform: rotate(90deg);
    }

    .mp-dropdown-options {
        position: absolute;
        top: calc(100% + 4px);
        left: 0;
        right: 0;
        background: var(--color-surface);
        border: 1px solid var(--color-border);
        border-radius: var(--radius-sm);
        //box-shadow: 0 4px 12px rgba(0, 0, 0, 0.2);
        z-index: 45000;
        max-height: 200px;
        overflow-y: auto;
        opacity: 0;
        visibility: hidden;
        transform: translateY(-8px);
        transition: opacity var(--transition-fast), visibility var(--transition-fast), transform var(--transition-fast);
    }

    .mp-dropdown.open .mp-dropdown-options {
        opacity: 1;
        visibility: visible;
        transform: translateY(0);
    }

    .mp-dropdown-option {
        padding: 8px 14px;
        font-size: 14px;
        color: var(--color-text-primary);
        cursor: pointer;
        user-select: none;
        transition: background var(--transition-fast);
        height: 34px;
        display: flex;
        align-items: center;
    }

    .mp-dropdown-option.selected {
        background: rgba(255, 102, 153, 0.13);
        color: var(--color-accent);
    }
`;
