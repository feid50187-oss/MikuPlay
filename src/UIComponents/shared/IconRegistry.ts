
import type { IconOptions } from './types';

const SVG_NS = 'http://www.w3.org/2000/svg';

function createSVG(options: IconOptions = {}): SVGElement {
    const el = document.createElementNS(SVG_NS, 'svg');
    el.setAttribute('viewBox', '0 0 24 24');
    el.setAttribute('fill', 'none');
    const size = options.size ?? 20;
    el.setAttribute('width', String(size));
    el.setAttribute('height', String(size));
    return el;
}

function createPath(d: string, color?: string): SVGPathElement {
    const path = document.createElementNS(SVG_NS, 'path');
    path.setAttribute('d', d);
    path.setAttribute('stroke', color ?? 'currentColor');
    path.setAttribute('stroke-width', '2');
    path.setAttribute('stroke-linecap', 'round');
    path.setAttribute('stroke-linejoin', 'round');
    return path;
}

function createFilledPath(d: string, color?: string): SVGPathElement {
    const path = document.createElementNS(SVG_NS, 'path');
    path.setAttribute('d', d);
    path.setAttribute('fill', color ?? 'currentColor');
    return path;
}

function chevronRight(options?: IconOptions): SVGElement {
    const svg = createSVG(options);
    svg.appendChild(createPath('M9 18l6-6-6-6', options?.color));
    return svg;
}

function chevronDown(options?: IconOptions): SVGElement {
    const svg = createSVG(options);
    svg.appendChild(createPath('M6 9l6 6 6-6', options?.color));
    return svg;
}

function close(options?: IconOptions): SVGElement {
    const svg = createSVG(options);
    svg.appendChild(createPath('M18 6L6 18M6 6l12 12', options?.color));
    return svg;
}

function folder(options?: IconOptions): SVGElement {
    const svg = createSVG(options);
    svg.appendChild(createFilledPath('M10 4H4a2 2 0 00-2 2v12a2 2 0 002 2h16a2 2 0 002-2V8a2 2 0 00-2-2h-8l-2-2z', options?.color));
    return svg;
}

function file(options?: IconOptions): SVGElement {
    const svg = createSVG(options);
    svg.appendChild(createPath('M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z M14 2v6h6', options?.color));
    return svg;
}

function play(options?: IconOptions): SVGElement {
    const svg = createSVG(options);
    svg.appendChild(createFilledPath('M8 5v14l11-7z', options?.color));
    return svg;
}

function pause(options?: IconOptions): SVGElement {
    const svg = createSVG(options);
    svg.appendChild(createFilledPath('M6 4h4v16H6zM14 4h4v16h-4z', options?.color));
    return svg;
}

function stop(options?: IconOptions): SVGElement {
    const svg = createSVG(options);
    svg.appendChild(createFilledPath('M6 6h12v12H6z', options?.color));
    return svg;
}

function settings(options?: IconOptions): SVGElement {
    const svg = createSVG(options);
    svg.appendChild(createPath('M12 15a3 3 0 100-6 3 3 0 000 6z M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 01-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z', options?.color));
    return svg;
}

function add(options?: IconOptions): SVGElement {
    const svg = createSVG(options);
    svg.appendChild(createPath('M12 5v14M5 12h14', options?.color));
    return svg;
}

function trash(options?: IconOptions): SVGElement {
    const svg = createSVG(options);
    svg.appendChild(createPath('M3 6h18M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2', options?.color));
    return svg;
}

function image(options?: IconOptions): SVGElement {
    const svg = createSVG(options);
    svg.appendChild(createPath('M21 15l-5-5L5 21 M14.5 9a2.5 2.5 0 100-5 2.5 2.5 0 000 5z', options?.color));
    svg.appendChild(createPath('M3 7V5a2 2 0 012-2h14a2 2 0 012 2v14a2 2 0 01-2 2H5a2 2 0 01-2-2v-2', options?.color));
    return svg;
}

/**
 * SVG 图标注册表
 * 使用方式: icons.chevronRight() 返回可追加到 DOM 的 SVGElement
 */
export const icons = {
    chevronRight,
    chevronDown,
    close,
    folder,
    file,
    play,
    pause,
    stop,
    settings,
    add,
    trash,
    image,
};

export type IconName = keyof typeof icons;
