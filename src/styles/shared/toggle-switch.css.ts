
export const toggleSwitchStyles = `
    .mp-toggle-item {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 8px 0;
        min-height: var(--touch-target-min);
        cursor: pointer;
    }

    .mp-toggle-label {
        font-size: 14px;
        font-weight: 500;
        color: var(--color-text-primary);
    }

    .mp-toggle-switch {
        width: 44px;
        height: 24px;
        border-radius: 12px;
        background: var(--color-border);
        position: relative;
        transition: background var(--transition-fast);
        flex-shrink: 0;
    }

    .mp-toggle-switch::after {
        content: '';
        position: absolute;
        top: 2px;
        left: 2px;
        width: 20px;
        height: 20px;
        border-radius: 50%;
        background: #fff;
        transition: transform var(--transition-fast), background var(--transition-fast);
        //box-shadow: var(--shadow-sm);
    }

    .mp-toggle-switch.active {
        background: var(--color-accent);
    }

    .mp-toggle-switch.active::after {
        transform: translateX(20px);
    }
`;
