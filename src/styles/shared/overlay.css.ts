
export const overlayStyles = `
    .mp-overlay {
        position: fixed;
        top: 0; left: 0; right: 0; bottom: 0;
        background: var(--color-overlay-bg);
        z-index: 50000;
        display: flex;
        align-items: center;
        justify-content: center;
        animation: mp-overlay-in 0.2s ease;
    }

    .mp-overlay.mp-overlay-out {
        animation: mp-overlay-out 0.15s ease forwards;
    }

    .mp-overlay-dialog {
        background: var(--color-surface);
        border-radius: var(--radius-lg);
        padding: 24px;
        min-width: 280px;
        max-width: 90vw;
        //box-shadow: var(--shadow-lg);
        animation: mp-dialog-in 0.25s ease;
    }

    @keyframes mp-overlay-in {
        from { opacity: 0; }
        to { opacity: 1; }
    }

    @keyframes mp-overlay-out {
        from { opacity: 1; }
        to { opacity: 0; }
    }

    @keyframes mp-dialog-in {
        from { opacity: 0; transform: scale(0.92); }
        to { opacity: 1; transform: scale(1); }
    }
`;
