/**
 * 导演模式核心逻辑
 * 从导演模式1.0.mkp 移植
 * 镜头节点导演工具
 */

export interface DirectorNode {
    id: string;
    name: string;
    startGap: number;
    duration: number;
    endGap: number;
    curve: 'linear' | 'sine' | 'exp' | 'inOut';
    type: string;
    params: Record<string, number | string | boolean>;
    startPose: CameraPose | null;
    endPose: CameraPose | null;
    bindModelId: string;
    bindBone: string;
    lockY: boolean;
    yOffset: number;
    transitionFromPrevious: 'jump' | 'smooth';
    startFrame?: number;
    motionStartFrame?: number;
    motionEndFrame?: number;
    endFrame?: number;
}

export interface CameraPose {
    tx: number;
    ty: number;
    tz: number;
    yaw: number;
    pitch: number;
    radius: number;
}

export interface DirectorPreset {
    name: string;
    nodes: DirectorNode[];
    createdAt: number;
}

export interface GlobalSettings {
    enabled: boolean;
    startGap: { enabled: boolean; value: number };
    duration: { enabled: boolean; value: number };
    endGap: { enabled: boolean; value: number };
    curve: { enabled: boolean; value: string };
    model: { enabled: boolean; value: string };
    bone: { enabled: boolean; value: string };
}

const FPS = 30;
const DEG = Math.PI / 180;
const MAX_NAME = 10;
const MAX_USER_PRESETS = 10;

const CURVES: Record<string, (t: number) => number> = {
    linear: (t) => t,
    sine: (t) => 0.5 - 0.5 * Math.cos(Math.PI * t),
    exp: (t) => t * t,
    inOut: (t) => (t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t)
};

const CURVE_NAMES: Record<string, string> = {
    linear: '线性',
    sine: '正弦',
    exp: '指数',
    inOut: '缓入缓出'
};

const SHOTS: Record<string, { name: string; duration: number; desc: string; params: string }> = {
    push: { name: '推进', duration: 150, desc: '镜头向目标靠近', params: 'factor' },
    pull: { name: '拉远', duration: 150, desc: '镜头远离目标', params: 'factor' },
    orbit: { name: '环绕', duration: 240, desc: '围绕目标连续旋转', params: 'angle' },
    crane: { name: '升降', duration: 180, desc: '改变镜头俯仰角', params: 'pitch' },
    pan: { name: '平移', duration: 180, desc: '改变镜头目标位置', params: 'dxz' },
    whip: { name: '甩镜', duration: 50, desc: '快速水平转向', params: 'angle' },
    follow: { name: '追踪', duration: 300, desc: '绑定模型骨骼作为镜头目标', params: 'track' }
};

const BONE_ALIASES: Record<string, string[]> = {
    '头': ['頭', '头', 'Head', 'head', '頭頂', '头顶'],
    '颈': ['首', '頸', '颈', 'Neck', 'neck'],
    '上半身': ['上半身', '上半身2', 'UpperBody', 'upper body', 'Upper Body'],
    '胸': ['胸', 'Chest', 'chest'],
    'センター': ['センター', 'Center', 'center'],
    '全ての親': ['全ての親', '全亲', '全親', 'All Parent', 'AllParent', 'all parent']
};

export function clamp(v: number, a: number, b: number): number {
    return v < a ? a : v > b ? b : v;
}

export function lerp(a: number, b: number, t: number): number {
    return a + (b - a) * t;
}

export function deg(r: number): number {
    return r / DEG;
}

export function truncateName(v: string, fallback: string): string {
    const s = String(v || '').trim();
    if (!s) return fallback || '镜头节点';
    return Array.from(s).slice(0, MAX_NAME).join('');
}

export function blankNode(name?: string): DirectorNode {
    return {
        id: 'node_' + Date.now() + '_' + Math.floor(Math.random() * 100000),
        name: truncateName(name || '', '镜头节点'),
        startGap: 0,
        duration: 120,
        endGap: 0,
        curve: 'inOut',
        type: 'custom',
        params: {},
        startPose: null,
        endPose: null,
        bindModelId: '',
        bindBone: '',
        lockY: false,
        yOffset: 0,
        transitionFromPrevious: 'jump'
    };
}

export function normalizeNode(n: Partial<DirectorNode>): DirectorNode {
    const x = blankNode(n?.name);
    return {
        ...x,
        id: n?.id || x.id,
        name: truncateName(n?.name || '', x.name),
        startGap: Math.max(0, Math.round(Number(n?.startGap) || 0)),
        duration: Math.max(1, Math.round(Number(n?.duration) || 120)),
        endGap: Math.max(0, Math.round(Number(n?.endGap) || 0)),
        curve: (n?.curve && CURVES[n.curve]) ? n.curve : 'inOut',
        type: n?.type || 'custom',
        params: n?.params || {},
        startPose: n?.startPose ? { ...n.startPose } : null,
        endPose: n?.endPose ? { ...n.endPose } : null,
        bindModelId: n?.bindModelId || '',
        bindBone: n?.bindBone || '',
        lockY: n?.lockY === true,
        yOffset: Number(n?.yOffset) || 0,
        transitionFromPrevious: n?.transitionFromPrevious === 'smooth' ? 'smooth' : 'jump'
    };
}

export function clonePose(p: CameraPose): CameraPose {
    return {
        tx: Number(p.tx) || 0,
        ty: Number(p.ty) || 0,
        tz: Number(p.tz) || 0,
        yaw: Number(p.yaw) || 0,
        pitch: Number(p.pitch) || 0,
        radius: Math.max(0.01, Number(p.radius) || 10)
    };
}

export { CURVES, CURVE_NAMES, SHOTS, BONE_ALIASES, DEG, FPS, MAX_NAME, MAX_USER_PRESETS };
