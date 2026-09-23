/**
 * 导演模式面板
 * 镜头节点导演工具
 */
import type { IPanel } from '../../../core/IPanel';
import type { MainWindow } from '../../MainWindow';
import {
    DirectorNode,
    CameraPose,
    DirectorPreset,
    GlobalSettings,
    CURVES,
    CURVE_NAMES,
    SHOTS,
    BONE_ALIASES,
    clamp,
    lerp,
    deg,
    truncateName,
    blankNode,
    normalizeNode,
    clonePose,
    DEG,
    FPS,
    MAX_USER_PRESETS
} from './directorCore';

const TAB_ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2" ry="2"/></svg>`;

export class DirectorPanel implements IPanel {
    readonly id = 'director';
    readonly tabLabel = '导演模式';
    readonly tabIcon = TAB_ICON;
    readonly element: HTMLElement;

    private mainWindow: MainWindow | null;
    private container: HTMLElement;
    private nodes: DirectorNode[] = [];
    private userPresets: DirectorPreset[] = [];
    private selectedNode: number = -1;
    private shooting: boolean = false;
    private hostPlaying: boolean = false;
    private savedCameraState: CameraPose | null = null;
    private renderObserver: any = null;
    private timelineMode: 'normal' | 'free' = 'normal';

    private globalSettings: GlobalSettings = {
        enabled: true,
        startGap: { enabled: false, value: 0 },
        duration: { enabled: false, value: 120 },
        endGap: { enabled: false, value: 0 },
        curve: { enabled: false, value: 'inOut' },
        model: { enabled: false, value: '' },
        bone: { enabled: false, value: '' }
    };

    private ui: Record<string, HTMLElement | null> = {};

    constructor(options: { mainWindow?: MainWindow }) {
        this.mainWindow = options.mainWindow ?? null;
        this.element = document.createElement('div');
        this.element.style.cssText = 'height:100%;display:flex;flex-direction:column;';

        this.container = document.createElement('div');
        this.container.style.cssText = 'padding:10px;overflow-y:auto;flex:1;';
        this.element.appendChild(this.container);

        this.buildUI();
        this.loadAll();
    }

    private getScene(): any {
        return this.mainWindow?.getSceneManager()?.getScene();
    }

    private getCamera(): any {
        const scene = this.getScene();
        return scene?.activeCamera;
    }

    private getAnimationManager(): any {
        return this.mainWindow?.getAnimationManager();
    }

    private getFrame(): number {
        const am = this.getAnimationManager();
        return am?.getCurrentAnimationTime?.() || 0;
    }

    private getMaxFrame(): number {
        const am = this.getAnimationManager();
        return am?.getMaxAnimationFrames?.() || 0;
    }

    private getModelManager(): any {
        return this.mainWindow?.getModelManager();
    }

    private pose(c: any): CameraPose {
        return {
            tx: c.target.x,
            ty: c.target.y,
            tz: c.target.z,
            yaw: c.rotation.y,
            pitch: c.rotation.x,
            radius: Math.max(0.01, Math.abs(c.distance))
        };
    }

    private apply(c: any, p: CameraPose): void {
        if (!c || !p) return;
        try {
            c.target.set(p.tx, p.ty, p.tz);
            c.rotation.set(p.pitch, p.yaw, 0);
            c.distance = -Math.max(0.01, p.radius);
            c.updatePosition?.();
        } catch (e) {
            console.warn('[导演模式] apply', e);
        }
    }

    private toast(type: 'info' | 'success' | 'error' | 'warning', msg: string): void {
        // 使用宿主 toast
        console.log(`[导演模式] ${type}: ${msg}`);
    }

    private createEl(tag: string, cls?: string, text?: string): HTMLElement {
        const el = document.createElement(tag);
        if (cls) el.className = cls;
        if (text !== undefined) el.textContent = text;
        return el;
    }

    private createBtn(text: string, primary?: boolean): HTMLButtonElement {
        const b = document.createElement('button');
        b.type = 'button';
        b.textContent = text;
        b.style.cssText = `
            min-height:30px;padding:5px 8px;border:1px solid var(--color-border,#777);
            border-radius:6px;background:var(--color-surface,#fff);color:var(--text-primary,#333);
            ${primary ? 'font-weight:700;' : ''}
        `;
        return b;
    }

    private createNumInput(v: number, min: number, max: number, step: number): HTMLInputElement {
        const i = document.createElement('input');
        i.type = 'number';
        i.value = String(v);
        i.min = String(min);
        i.max = String(max);
        i.step = String(step);
        i.style.cssText = 'width:100%;padding:6px;border:1px solid #ddd;border-radius:6px;box-sizing:border-box;';
        return i;
    }

    private createTextInput(v: string, placeholder?: string): HTMLInputElement {
        const i = document.createElement('input');
        i.type = 'text';
        i.value = v || '';
        i.placeholder = placeholder || '';
        i.maxLength = 10;
        i.style.cssText = 'width:100%;padding:6px;border:1px solid #ddd;border-radius:6px;box-sizing:border-box;';
        return i;
    }

    private createSelect(opts: { label: string; value: string }[], value: string): HTMLSelectElement {
        const s = document.createElement('select');
        s.style.cssText = 'width:100%;padding:6px;border:1px solid #ddd;border-radius:6px;box-sizing:border-box;';
        opts.forEach(o => {
            const p = document.createElement('option');
            p.value = o.value;
            p.textContent = o.label;
            if (o.value === value) p.selected = true;
            s.appendChild(p);
        });
        return s;
    }

    private createRow(label: string, input: HTMLElement, help?: string): HTMLElement {
        const d = document.createElement('div');
        d.style.cssText = 'display:grid;grid-template-columns:80px 1fr;gap:6px;align-items:center;margin:5px 0;';
        const left = document.createElement('div');
        const l = document.createElement('div');
        l.style.cssText = 'font-size:12px;font-weight:600;';
        l.textContent = label;
        left.appendChild(l);
        if (help) {
            const h = document.createElement('div');
            h.style.cssText = 'font-size:10px;color:#888;margin-top:2px;';
            h.textContent = help;
            left.appendChild(h);
        }
        d.appendChild(left);
        d.appendChild(input);
        return d;
    }

    private createSection(title: string, collapsible?: boolean, open?: boolean): { root: HTMLElement; body: HTMLElement } {
        const s = document.createElement('div');
        s.style.cssText = 'border:1px solid #e0e0e0;border-radius:8px;padding:10px;margin-bottom:10px;';
        const head = document.createElement('div');
        head.style.cssText = 'display:flex;align-items:center;gap:6px;';
        const h = document.createElement('div');
        h.style.cssText = 'font-size:14px;font-weight:700;flex:1;';
        h.textContent = title;
        head.appendChild(h);
        const body = document.createElement('div');

        if (collapsible) {
            const toggle = this.createBtn(open === false ? '展开' : '收起');
            toggle.style.minWidth = '48px';
            toggle.onclick = () => {
                const on = body.style.display !== 'none';
                body.style.display = on ? 'none' : 'block';
                toggle.textContent = on ? '展开' : '收起';
            };
            head.appendChild(toggle);
            body.style.display = open === false ? 'none' : 'block';
        }

        s.appendChild(head);
        s.appendChild(body);
        return { root: s, body };
    }

    private modelList(): { label: string; value: string }[] {
        const out: { label: string; value: string }[] = [];
        try {
            const mm = this.getModelManager();
            const ms = mm?.getAllModels?.() || [];
            ms.forEach((m: any) => {
                out.push({ label: m.name || m.id, value: m.id });
            });
        } catch (e) {}
        return out;
    }

    private boneOptions(modelId: string, current: string): { label: string; value: string }[] {
        const opts: { label: string; value: string }[] = [{ label: '自动 Center/全亲', value: '' }];
        // 简化版骨骼选项
        const names = ['頭', '首', '上半身', 'センター', '全ての親'];
        names.forEach(n => opts.push({ label: n, value: n }));
        return opts;
    }

    private currentBasePose(): CameraPose {
        const c = this.getCamera();
        return c ? this.pose(c) : { tx: 0, ty: 0, tz: 0, yaw: 0, pitch: 0, radius: 10 };
    }

    private recomputeTimeline(): number {
        let frame = 0;
        let prev = this.currentBasePose();
        this.nodes.forEach((n) => {
            n.startFrame = frame;
            n.startPose = n.startPose || clonePose(prev);
            frame += n.startGap;
            n.motionStartFrame = n.startFrame + n.startGap;
            n.motionEndFrame = n.motionStartFrame + n.duration;
            n.endFrame = n.motionEndFrame + n.endGap;
            n.endPose = n.endPose ? clonePose(n.endPose) : clonePose(n.startPose!);
            prev = n.endPose;
            frame = n.endFrame;
        });
        return frame;
    }

    private totalFrames(): number {
        return this.recomputeTimeline();
    }

    private canUseTotal(total: number, quiet?: boolean): boolean {
        const max = this.getMaxFrame();
        if (this.timelineMode === 'free' || max <= 0) return true;
        if (total <= max) return true;
        if (!quiet) this.toast('warning', `常规模式限制：镜头总时长 ${Math.round(total)} 帧超过当前动作总时长 ${Math.round(max)} 帧。`);
        return false;
    }

    private nodePoseAt(n: DirectorNode, f: number): CameraPose {
        const s = n.startPose!;
        const e = n.endPose || n.startPose!;
        if (f < n.motionStartFrame!) return s;
        if (f >= n.motionEndFrame!) return e;
        const t = (f - n.motionStartFrame!) / Math.max(1, n.duration);
        const q = (CURVES[n.curve] || CURVES.linear)(clamp(t, 0, 1));
        return {
            tx: lerp(s.tx, e.tx, q),
            ty: lerp(s.ty, e.ty, q),
            tz: lerp(s.tz, e.tz, q),
            yaw: lerp(s.yaw, e.yaw, q),
            pitch: lerp(s.pitch, e.pitch, q),
            radius: lerp(s.radius, e.radius, q)
        };
    }

    private timelinePose(f: number): CameraPose | null {
        if (!this.nodes.length) return null;
        for (let i = 0; i < this.nodes.length; i++) {
            const n = this.nodes[i];
            if (f <= n.endFrame!) {
                return this.nodePoseAt(n, f);
            }
        }
        return this.nodePoseAt(this.nodes[this.nodes.length - 1], this.nodes[this.nodes.length - 1].endFrame!);
    }

    private createNode(type: string, duration: number, curve: string, params: any, name?: string): boolean {
        const c = this.getCamera();
        if (!c) return false;
        const n = blankNode(name || SHOTS[type].name);
        n.type = type;
        n.duration = Math.max(1, Math.round(duration || SHOTS[type].duration));
        n.curve = (CURVES as any)[curve] ? (curve as any) : 'inOut';
        n.params = params || {};
        n.startPose = clonePose(this.currentBasePose());
        n.endPose = clonePose(n.startPose);

        if (type === 'push') n.endPose!.radius = Math.max(0.1, n.startPose!.radius * (params.factor || 0.55));
        else if (type === 'pull') n.endPose!.radius = Math.max(0.1, n.startPose!.radius * (params.factor || 1.8));
        else if (type === 'orbit') n.endPose!.yaw = n.startPose!.yaw + (params.angle || 360) * DEG;
        else if (type === 'whip') n.endPose!.yaw = n.startPose!.yaw + (params.angle || 120) * DEG;
        else if (type === 'crane') n.endPose!.pitch = clamp(n.startPose!.pitch + (params.pitchDelta || 45) * DEG, -89 * DEG, 89 * DEG);
        else if (type === 'pan') {
            n.endPose!.tx += params.dx || 3;
            n.endPose!.tz += params.dz || 0;
        }

        const old = this.nodes.length;
        this.nodes.push(n);
        const t = this.totalFrames();
        if (!this.canUseTotal(t)) {
            this.nodes.length = old;
            return false;
        }
        this.selectedNode = this.nodes.length - 1;
        this.recomputeTimeline();
        this.renderAll();
        this.toast('success', `已创建镜头节点"${n.name}"，${n.duration} 帧`);
        return true;
    }

    private captureNode(): void {
        const c = this.getCamera();
        if (!c) return;
        const n = blankNode('关键帧');
        n.type = 'custom';
        n.duration = 120;
        n.startPose = clonePose(this.pose(c));
        n.endPose = clonePose(n.startPose);
        this.nodes.push(n);
        this.recomputeTimeline();
        this.renderAll();
    }

    private deleteNode(i: number): void {
        if (i < 0 || i >= this.nodes.length) return;
        this.nodes.splice(i, 1);
        this.selectedNode = Math.min(this.selectedNode, this.nodes.length - 1);
        this.recomputeTimeline();
        this.renderAll();
    }

    private moveNode(i: number, dir: number): void {
        const j = i + dir;
        if (j < 0 || j >= this.nodes.length) return;
        const x = this.nodes[i];
        this.nodes[i] = this.nodes[j];
        this.nodes[j] = x;
        this.selectedNode = j;
        this.recomputeTimeline();
        this.renderAll();
    }

    private startTakeover(): void {
        const c = this.getCamera();
        if (!c) {
            this.toast('error', '未找到相机');
            return;
        }
        if (!this.nodes.length) {
            this.toast('error', '请先创建镜头节点');
            return;
        }
        this.savedCameraState = this.pose(c);
        this.shooting = true;
        this.ensureObserver();
        this.renderAll();
        this.toast('success', '镜头接管已就绪：程序播放后按节点顺序执行');
    }

    private stopTakeover(): void {
        this.removeObserver();
        this.shooting = false;
        this.hostPlaying = false;
        if (this.savedCameraState && this.getCamera()) {
            this.apply(this.getCamera(), this.savedCameraState);
        }
        this.savedCameraState = null;
        this.renderAll();
        this.toast('info', '已停止拍摄并解除镜头接管');
    }

    private ensureObserver(): void {
        const scene = this.getScene();
        if (this.renderObserver || !scene?.onBeforeRenderObservable) return;
        this.renderObserver = scene.onBeforeRenderObservable.add(() => {
            if (!this.shooting) return;
            const f = this.getFrame();
            this.hostPlaying = true;
            const p = this.timelinePose(f);
            if (p) this.apply(this.getCamera(), p);
            this.updateProgress(f);
        });
    }

    private removeObserver(): void {
        const scene = this.getScene();
        if (this.renderObserver && scene) {
            try {
                scene.onBeforeRenderObservable.remove(this.renderObserver);
            } catch (e) {}
        }
        this.renderObserver = null;
    }

    private updateProgress(f: number): void {
        const t = this.totalFrames();
        const m = this.getMaxFrame();
        if (this.ui.progress) {
            (this.ui.progress as HTMLProgressElement).max = Math.max(1, this.timelineMode === 'normal' && m > 0 ? m : t);
            (this.ui.progress as HTMLProgressElement).value = clamp(f, 0, (this.ui.progress as HTMLProgressElement).max);
        }
        if (this.ui.frame) {
            this.ui.frame.textContent = `程序当前帧：${Math.round(f)} / 镜头总长：${Math.round(t)} / 动作总长：${Math.round(m)}`;
        }
    }

    private buildUI(): void {
        this.container.innerHTML = '';

        // 标题
        const title = this.createEl('div', '', '导演模式 V1.0');
        title.style.cssText = 'font-size:16px;font-weight:700;margin-bottom:8px;';
        this.container.appendChild(title);

        // 顶部两行：播放控制 + 抓取关键帧
        const topRow = document.createElement('div');
        topRow.style.cssText = 'display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:10px;';

        // 播放控制
        const controlsSection = this.createSection('① 播放控制');
        this.ui.controls = controlsSection.body;
        this.renderControls();
        topRow.appendChild(controlsSection.root);

        // 抓取关键帧
        const captureSection = this.createSection('② 抓取关键帧');
        this.ui.capture = captureSection.body;
        this.renderCapture();
        topRow.appendChild(captureSection.root);

        this.container.appendChild(topRow);

        // 全局参数
        const globalSection = this.createSection('③ 全局镜头参数', true, true);
        this.ui.global = globalSection.body;
        this.renderGlobal();
        this.container.appendChild(globalSection.root);

        // 节点列表
        const nodesSection = this.createSection('④ 镜头节点列表', true, true);
        this.ui.list = nodesSection.body;
        this.renderNodes();
        this.container.appendChild(nodesSection.root);

        // 用户预设
        const presetSection = this.createSection('⑤ 用户预设镜头组', true, true);
        this.ui.userPresets = presetSection.body;
        this.renderUserPresets();
        this.container.appendChild(presetSection.root);

        // 预设镜头库
        const librarySection = this.createSection('⑥ 预设镜头库', true, false);
        this.ui.library = librarySection.body;
        this.renderLibrary();
        this.container.appendChild(librarySection.root);

        // 时长约束
        const modeSection = this.createSection('⑦ 镜头时长约束', true, true);
        this.ui.mode = modeSection.body;
        this.renderMode();
        this.container.appendChild(modeSection.root);

        // 进度条
        this.ui.progress = document.createElement('progress');
        this.ui.progress.style.cssText = 'width:100%;height:8px;margin-top:10px;';
        this.container.appendChild(this.ui.progress);

        this.ui.frame = this.createEl('div', '', '程序当前帧：0');
        this.ui.frame.style.cssText = 'font-size:12px;color:#666;margin-top:5px;';
        this.container.appendChild(this.ui.frame);
    }

    private renderControls(): void {
        if (!this.ui.controls) return;
        this.ui.controls.innerHTML = '';

        const status = this.createEl('div', '', this.shooting ? '● 已接管 · ' + (this.hostPlaying ? '程序正在播放' : '程序暂停/等待') : '○ 未接管');
        status.style.cssText = 'font-size:12px;margin-bottom:8px;';
        this.ui.controls.appendChild(status);

        const btn = this.createBtn(this.shooting ? '⏹ 停止拍摄' : '▶ 开始拍摄', true);
        btn.style.width = '100%';
        btn.onclick = () => {
            this.shooting ? this.stopTakeover() : this.startTakeover();
        };
        this.ui.controls.appendChild(btn);
    }

    private renderCapture(): void {
        if (!this.ui.capture) return;
        this.ui.capture.innerHTML = '';

        const durationInput = this.createNumInput(120, 1, 999999, 1);
        this.ui.captureDuration = durationInput as any;
        this.ui.capture.appendChild(this.createRow('动作帧', durationInput, '抓取镜头的动作时长'));

        const curveSelect = this.createSelect(
            Object.keys(CURVE_NAMES).map(k => ({ label: CURVE_NAMES[k], value: k })),
            'inOut'
        );
        this.ui.captureCurve = curveSelect as any;
        this.ui.capture.appendChild(this.createRow('曲线', curveSelect, '控制动作速度'));

        const btn = this.createBtn('◎ 抓取当前视角', true);
        btn.style.width = '100%';
        btn.onclick = () => this.captureNode();
        this.ui.capture.appendChild(btn);
    }

    private renderGlobal(): void {
        if (!this.ui.global) return;
        this.ui.global.innerHTML = '';

        // 简化版全局参数
        const hint = this.createEl('div', '', '勾选同步：立即应用到现有节点，并用于新节点');
        hint.style.cssText = 'font-size:11px;color:#888;margin-bottom:8px;';
        this.ui.global.appendChild(hint);

        // 统一起始间隔
        const gapInput = this.createNumInput(0, 0, 999999, 1);
        this.ui.global.appendChild(this.createRow('起始间隔帧', gapInput));

        // 统一运动时长
        const durInput = this.createNumInput(120, 1, 999999, 1);
        this.ui.global.appendChild(this.createRow('运动时长帧', durInput));

        // 统一曲线
        const curveSelect = this.createSelect(
            Object.keys(CURVE_NAMES).map(k => ({ label: CURVE_NAMES[k], value: k })),
            'inOut'
        );
        this.ui.global.appendChild(this.createRow('插值曲线', curveSelect));
    }

    private renderNodes(): void {
        if (!this.ui.list) return;
        this.ui.list.innerHTML = '';

        if (!this.nodes.length) {
            this.ui.list.appendChild(this.createEl('div', '', '暂无镜头节点。请抓取当前视角或创建预设镜头。'));
            return;
        }

        this.nodes.forEach((n, i) => {
            const card = document.createElement('div');
            card.style.cssText = 'border:1px solid #e0e0e0;border-radius:8px;margin:6px 0;padding:8px;';

            // 顶部行
            const top = document.createElement('div');
            top.style.cssText = 'display:flex;align-items:center;gap:4px;';

            const title = this.createEl('div', '', `↕ ${i + 1}  ${truncateName(n.name, '镜头节点')}`);
            title.style.cssText = 'font-weight:600;font-size:12px;flex:1;';
            top.appendChild(title);

            const editBtn = this.createBtn('编辑');
            editBtn.onclick = () => this.editNode(i);
            top.appendChild(editBtn);

            const upBtn = this.createBtn('↑');
            upBtn.onclick = () => this.moveNode(i, -1);
            top.appendChild(upBtn);

            const dnBtn = this.createBtn('↓');
            dnBtn.onclick = () => this.moveNode(i, 1);
            top.appendChild(dnBtn);

            const delBtn = this.createBtn('删');
            delBtn.onclick = () => this.deleteNode(i);
            top.appendChild(delBtn);

            card.appendChild(top);

            // 信息行
            const info = this.createEl('div', '', `起始 ${n.startGap}帧 · 运动 ${n.duration}帧 · 结束 ${n.endGap}帧 · 总 ${n.startGap + n.duration + n.endGap}帧`);
            info.style.cssText = 'font-size:11px;color:#888;margin-top:5px;';
            card.appendChild(info);

            const time = this.createEl('div', '', `时间轴：${n.startFrame} → ${n.endFrame} · ${CURVE_NAMES[n.curve] || n.curve}`);
            time.style.cssText = 'font-size:11px;color:#888;';
            card.appendChild(time);

            this.ui.list.appendChild(card);
        });

        // 汇总
        const total = this.totalFrames();
        const sum = this.createEl('div', '', `共 ${this.nodes.length} 个镜头节点 · 总时长 ${total} 帧`);
        sum.style.cssText = 'font-size:12px;color:#888;margin-top:8px;';
        this.ui.list.appendChild(sum);
    }

    private renderUserPresets(): void {
        if (!this.ui.userPresets) return;
        this.ui.userPresets.innerHTML = '';

        const hint = this.createEl('div', '', '最多10组；可导出为明文 JS');
        hint.style.cssText = 'font-size:10px;color:#888;margin-bottom:6px;';
        this.ui.userPresets.appendChild(hint);

        if (!this.userPresets.length) {
            this.ui.userPresets.appendChild(this.createEl('div', '', '暂无用户预设'));
        } else {
            this.userPresets.forEach((p, i) => {
                const card = document.createElement('div');
                card.style.cssText = 'border:1px solid #e0e0e0;border-radius:6px;padding:6px;margin:4px 0;';

                const top = document.createElement('div');
                top.style.cssText = 'display:grid;grid-template-columns:1fr auto auto auto;gap:4px;';

                const title = this.createEl('div', '', `${p.name} · ${p.nodes.length}节点`);
                title.style.cssText = 'font-weight:600;font-size:12px;';
                top.appendChild(title);

                const repBtn = this.createBtn('替换');
                repBtn.onclick = () => this.loadUserPreset(i, false);
                top.appendChild(repBtn);

                const addBtn = this.createBtn('追加');
                addBtn.onclick = () => this.loadUserPreset(i, true);
                top.appendChild(addBtn);

                const delBtn = this.createBtn('删');
                delBtn.onclick = () => this.deleteUserPreset(i);
                top.appendChild(delBtn);

                card.appendChild(top);
                this.ui.userPresets.appendChild(card);
            });
        }

        // 操作按钮
        const actions = document.createElement('div');
        actions.style.cssText = 'display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-top:6px;';

        const saveBtn = this.createBtn('＋ 保存当前组', true);
        saveBtn.onclick = () => this.saveUserPreset();
        actions.appendChild(saveBtn);

        const importBtn = this.createBtn('从内容库导入');
        importBtn.onclick = () => this.importPreset();
        actions.appendChild(importBtn);

        this.ui.userPresets.appendChild(actions);

        // 导出按钮
        const exportBtn = this.createBtn('导出到内容库');
        exportBtn.style.width = '100%';
        exportBtn.style.marginTop = '6px';
        exportBtn.onclick = () => this.exportPreset();
        this.ui.userPresets.appendChild(exportBtn);
    }

    private renderLibrary(): void {
        if (!this.ui.library) return;
        this.ui.library.innerHTML = '';

        const typeSelect = this.createSelect(
            Object.keys(SHOTS).map(k => ({ label: SHOTS[k].name, value: k })),
            'push'
        );
        this.ui.library.appendChild(this.createRow('预设镜头', typeSelect));

        const nameInput = this.createTextInput('', '节点名称');
        this.ui.library.appendChild(this.createRow('节点名称', nameInput));

        const durInput = this.createNumInput(150, 1, 999999, 1);
        this.ui.library.appendChild(this.createRow('运动时长帧', durInput));

        const factorInput = this.createNumInput(0.55, 0.05, 10, 0.05);
        this.ui.library.appendChild(this.createRow('推进/拉远倍率', factorInput, '<1推进，>1拉远'));

        const angleInput = this.createNumInput(360, -3600, 3600, 1);
        this.ui.library.appendChild(this.createRow('环绕/甩镜角度°', angleInput, '360°=一圈'));

        const genBtn = this.createBtn('＋ 创建一个镜头节点', true);
        genBtn.style.width = '100%';
        genBtn.onclick = () => {
            const type = typeSelect.value;
            const duration = Number(durInput.value) || 150;
            const factor = Number(factorInput.value) || 0.55;
            const angle = Number(angleInput.value) || 360;
            const params: any = {};
            if (type === 'push' || type === 'pull') params.factor = factor;
            if (type === 'orbit' || type === 'whip') params.angle = angle;
            this.createNode(type, duration, 'inOut', params, nameInput.value.trim() || undefined);
        };
        this.ui.library.appendChild(genBtn);
    }

    private renderMode(): void {
        if (!this.ui.mode) return;
        this.ui.mode.innerHTML = '';

        const modeSelect = this.createSelect([
            { label: '常规模式：受动作总帧数约束', value: 'normal' },
            { label: '自由模式：镜头总帧数不限', value: 'free' }
        ], this.timelineMode);

        this.ui.mode.appendChild(this.createRow('镜头时长模式', modeSelect, '常规模式下镜头总时长不能超过当前动作总帧数'));

        modeSelect.onchange = () => {
            this.timelineMode = modeSelect.value as 'normal' | 'free';
            this.renderAll();
        };
    }

    private editNode(i: number): void {
        const n = this.nodes[i];
        if (!n) return;

        // 简化版编辑：弹出 prompt
        const newName = prompt('节点名称（最多10字符）:', n.name);
        if (newName) n.name = truncateName(newName, n.name);

        const newDur = prompt('运动时长（帧）:', String(n.duration));
        if (newDur) n.duration = Math.max(1, Math.round(Number(newDur) || 120));

        this.recomputeTimeline();
        this.renderAll();
    }

    private saveUserPreset(): void {
        if (!this.nodes.length) {
            this.toast('warning', '当前没有镜头节点可保存');
            return;
        }
        if (this.userPresets.length >= MAX_USER_PRESETS) {
            this.toast('warning', `最多同时收藏 ${MAX_USER_PRESETS} 组用户预设`);
            return;
        }
        const name = prompt('预设组名称（最多10字符）:', '未命名镜头组');
        if (!name) return;
        this.userPresets.push({
            name: truncateName(name, '未命名镜头组'),
            nodes: JSON.parse(JSON.stringify(this.nodes)),
            createdAt: Date.now()
        });
        this.renderUserPresets();
        this.toast('success', `已保存镜头组"${name}"`);
    }

    private loadUserPreset(i: number, append: boolean): void {
        const preset = this.userPresets[i];
        if (!preset) return;
        const incoming = preset.nodes.map(normalizeNode);
        this.nodes = append ? this.nodes.concat(incoming) : incoming;
        this.recomputeTimeline();
        this.renderAll();
        this.toast('success', `已${append ? '追加' : '替换'}为镜头组"${preset.name}"`);
    }

    private deleteUserPreset(i: number): void {
        this.userPresets.splice(i, 1);
        this.renderUserPresets();
    }

    private renderAll(): void {
        this.renderControls();
        this.renderNodes();
        this.renderUserPresets();
        this.updateProgress(this.getFrame());
    }

    private saveAll(): void {
        // 保存到 localStorage（临时缓存）
        localStorage.setItem('director_nodes', JSON.stringify({ nodes: this.nodes }));
        localStorage.setItem('director_presets', JSON.stringify({ presets: this.userPresets }));

        // 同步到内容库（异步）
        this.syncToContentLibrary();
    }

    /**
     * 同步到内容库
     */
    private async syncToContentLibrary(): Promise<void> {
        try {
            const { contentLibraryApi } = await import('../../../features/library/ContentLibraryApi');
            const data = JSON.stringify({
                format: 'MikuPlayReburn.DirectorPreset',
                version: '1.0',
                nodes: this.nodes,
                presets: this.userPresets,
                savedAt: new Date().toISOString()
            });
            const blob = new Blob([data], { type: 'application/json' });
            await contentLibraryApi.addAsset(blob, 'projects', '导演模式_当前预设.json');
        } catch (e) {
            console.warn('[导演模式] 同步到内容库失败:', e);
        }
    }

    /**
     * 导出预设到内容库
     */
    async exportPreset(): Promise<void> {
        try {
            const { contentLibraryApi } = await import('../../../features/library/ContentLibraryApi');
            const name = prompt('输入预设名称:', `导演预设_${new Date().toLocaleDateString()}`);
            if (!name) return;

            const data = JSON.stringify({
                format: 'MikuPlayReburn.DirectorPreset',
                version: '1.0',
                name: name,
                nodes: this.nodes,
                exportedAt: new Date().toISOString()
            });
            const blob = new Blob([data], { type: 'application/json' });
            await contentLibraryApi.addAsset(blob, 'projects', `${name}.json`);
            this.toast('success', `预设已导出到内容库: ${name}`);
        } catch (e) {
            this.toast('error', `导出失败: ${(e as Error).message}`);
        }
    }

    /**
     * 从内容库导入预设
     */
    async importPreset(): Promise<void> {
        try {
            const { contentLibraryApi } = await import('../../../features/library/ContentLibraryApi');
            const assets = contentLibraryApi.listAssets('projects');

            // 过滤导演模式预设
            const presets = assets.filter(a => a.name.includes('导演') || a.name.includes('director'));

            if (presets.length === 0) {
                this.toast('warning', '内容库中没有找到导演模式预设');
                return;
            }

            // 选择要导入的预设
            const list = presets.map((p, i) => `${i + 1}. ${p.name}`).join('\n');
            const choice = prompt(`选择要导入的预设:\n${list}`);
            if (!choice) return;

            const idx = Number(choice) - 1;
            if (idx < 0 || idx >= presets.length) {
                this.toast('error', '无效选择');
                return;
            }

            // 读取文件内容
            const asset = presets[idx];
            const data = await contentLibraryApi.readFile(asset.path);
            const text = new TextDecoder().decode(data);
            const json = JSON.parse(text);

            if (json.format !== 'MikuPlayReburn.DirectorPreset') {
                this.toast('error', '文件格式不正确');
                return;
            }

            // 应用导入
            this.nodes = (json.nodes || []).map(normalizeNode);
            this.recomputeTimeline();
            this.renderAll();
            this.toast('success', `已导入预设: ${json.name || asset.name}`);
        } catch (e) {
            this.toast('error', `导入失败: ${(e as Error).message}`);
        }
    }

    private loadAll(): void {
        try {
            const nodesRaw = localStorage.getItem('director_nodes');
            if (nodesRaw) {
                const data = JSON.parse(nodesRaw);
                if (Array.isArray(data.nodes)) {
                    this.nodes = data.nodes.map(normalizeNode);
                }
            }
            const presetsRaw = localStorage.getItem('director_presets');
            if (presetsRaw) {
                const data = JSON.parse(presetsRaw);
                if (Array.isArray(data.presets)) {
                    this.userPresets = data.presets;
                }
            }
        } catch (e) {
            console.warn('[导演模式] 加载存档失败', e);
        }
        this.renderAll();
    }

    onShow(): void {
        this.renderAll();
    }

    onHide(): void {
        this.saveAll();
    }

    mount(container: HTMLElement): void {
        container.appendChild(this.element);
    }

    unmount(): void {
        if (this.element.parentElement) {
            this.element.parentElement.removeChild(this.element);
        }
    }

    dispose(): void {
        this.removeObserver();
        this.saveAll();
        this.nodes = [];
        this.userPresets = [];
    }
}

export default DirectorPanel;
