/*
 * 面部相机 V1.0
 * 集成版
 *
 * 重要架构：
 * 1. 面部相机与目光跟随分别封装在独立模块工厂中。
 * 2. 两个模块的 exports / ctx / scene / 状态变量完全隔离。
 * 3. 第一页只通过 setEnabled/isEnabled 与目光跟随建立最小控制桥。
 * 4. 两者不共享模型目标。
 */



export function createFaceCameraModule() {
        /* FACE_MODULE_BEGIN */
        /**
         * 相机面部追踪 v1.0.8
         *
         * v1.0.8 新增：
         *   1. One Euro 滤波器替换一阶 EMA：静止强防抖、高速自动跟手（动捕/相机追踪行业标准方案）
         *   2. 防抖死区：冻结静止时的微小抖动（位置+旋转独立阈值）
         *   3. 视角坐标补偿：距离（推近/拉远倍率）、俯仰（机位升高俯拍/降低仰拍）、取景高度（注视点上下）
         *
         * 历史：
         *   v1.0.6 修复多实例 observer 争抢相机、新增跟随旋转
         *   v1.0.7 一阶 EMA 惯性（已被 One Euro 取代）
         *
         * 相机控制（导演模式真机验证）：
         *   MmdCamera：target + rotation(pitch,yaw) + distance(负) + updatePosition()
         * 骨骼（眼球追踪真机验证）：
         *   runtimeBone.getWorldMatrixToRef() 直接给出世界矩阵
         */



            var PLUGIN_VERSION = '1.0.8';
            var DEG = Math.PI / 180;

            // ===== 单例注册表（挂 window，插件重载后仍可见，用于清理旧 observer）=====
            var G = window.__CAMERA_FACE_TRACK__;
            if (!G) {
                G = window.__CAMERA_FACE_TRACK__ = { observers: [], version: PLUGIN_VERSION };
            }
            G.version = PLUGIN_VERSION;

            // ===== 全局状态 =====
            var container = null;
            var scene = null;
            var ctx = null;
            var renderObserver = null;

            var models = [];
            var selectedModelId = null;
            var headRuntimeBone = null;
            var isTracking = false;

            var camInitPose = null;
            var followRotation = true;
            var headInitYaw = 0;
            var yawOffset = 0;

            // ----- 平滑参数 -----
            var smoothEnabled = true;
            var posSmooth = 0.15;     // 滑块 0.02(沉稳)~1(灵敏)
            var rotSmooth = 0.12;
            var stableStrength = 0.4; // 防抖死区强度 0~1

            // ----- 视角坐标补偿 -----
            var distScale = 1.0;          // 距离倍率
            var pitchOffsetDeg = 0;       // 俯仰补偿（度）
            var targetHeightOffset = 0;   // 注视点高度偏移（世界单位）

            // 滤波器
            var fPosX, fPosY, fPosZ, fYaw;
            var continuousYaw = 0;  // 解环绕后的连续 yaw
            var filtersInited = false;

            // 日志
            var logs = [];
            var frameCount = 0;

            // 复用临时对象
            var tmpMatrix = null;
            var tmpPos = null;

            // DOM
            var modelSelectEl = null;
            var bindBtnEl = null;
            var unbindBtnEl = null;
            var followRotEl = null;
            var smoothEnableEl = null;
            var statusEl = null;
            var headInfoEl = null;
            var camInfoEl = null;
            var logPanelEl = null;
            var logTextEl = null;

            // ===== One Euro 滤波器 =====
            // 参考：Casiez et al. 2012, "1€ Filter"。低速低截止频率（强平滑去抖），高速提高截止频率（低延迟跟手）。

            function LowPass() {
                this.s = null;
                this.y = null;
            }
            LowPass.prototype.filter = function (x, a) {
                if (this.s === null) this.s = x;
                else this.s = a * x + (1 - a) * this.s;
                this.y = x;
                return this.s;
            };
            LowPass.prototype.reset = function (v) {
                this.s = (v === undefined) ? null : v;
                this.y = null;
            };

            function OneEuro(minCutoff, beta, dCutoff) {
                this.minCutoff = minCutoff;
                this.beta = beta;
                this.dCutoff = dCutoff;
                this.xf = new LowPass();
                this.dxf = new LowPass();
                this.lastX = null;
                this.lastT = null;
            }
            OneEuro.prototype.alpha = function (cutoff, dt) {
                var tau = 1 / (2 * Math.PI * cutoff);
                return 1 / (1 + tau / dt);
            };
            OneEuro.prototype.filter = function (x, t) {
                if (this.lastT === null) {
                    this.lastX = x; this.lastT = t;
                    this.dxf.reset(0);
                    return this.xf.filter(x, 1);
                }
                var dt = t - this.lastT;
                if (dt <= 0) dt = 1 / 60;
                var dx = (x - this.lastX) / dt;
                var edx = this.dxf.filter(dx, this.alpha(this.dCutoff, dt));
                var cutoff = this.minCutoff + this.beta * Math.abs(edx);
                var fx = this.xf.filter(x, this.alpha(cutoff, dt));
                this.lastX = x; this.lastT = t;
                return fx;
            };
            OneEuro.prototype.reset = function (v) {
                this.xf.reset(v);
                this.dxf.reset(0);
                this.lastX = (v === undefined) ? null : v;
                this.lastT = null;
            };

            // 滑块值（0.02 沉稳 ~ 1 灵敏）→ One Euro 最小截止频率（0.15Hz 很平滑 ~ 10Hz 很跟手）
            function smoothToCutoff(s) {
                var t = (Math.max(0.02, Math.min(1, s)) - 0.02) / (1 - 0.02);
                return 0.15 * Math.pow(10 / 0.15, t);
            }

            // 最短角度差（归一化到 -π~π）
            function angleDiff(a, b) {
                var d = a - b;
                while (d > Math.PI) d -= 2 * Math.PI;
                while (d < -Math.PI) d += 2 * Math.PI;
                return d;
            }

            // 死区：变化小于阈值视为抖动；超过阈值则减去阈值（避免阶梯感）
            function applyDeadzone(diff, dz) {
                if (Math.abs(diff) < dz) return 0;
                return diff - (diff > 0 ? dz : -dz);
            }

            function initFilters(px, py, pz, yaw) {
                var pc = smoothToCutoff(posSmooth);
                var rc = smoothToCutoff(rotSmooth);
                fPosX = new OneEuro(pc, 0.05, 1);
                fPosY = new OneEuro(pc, 0.05, 1);
                fPosZ = new OneEuro(pc, 0.05, 1);
                fYaw = new OneEuro(rc, 0.08, 1);
                fPosX.reset(px); fPosY.reset(py); fPosZ.reset(pz);
                fYaw.reset(yaw);
                continuousYaw = yaw;
                filtersInited = true;
            }

            // ===== 日志 =====

            function log(msg) {
                var time = new Date().toLocaleTimeString();
                logs.push('[' + time + '] ' + msg);
                if (logs.length > 300) logs.shift();
                if (logTextEl) {
                    logTextEl.textContent = logs.join('\n');
                    logPanelEl.scrollTop = logPanelEl.scrollHeight;
                }
                console.log('[CameraFaceTracking]', msg);
            }

            function copyLog() {
                var ta = document.createElement('textarea');
                ta.value = logs.join('\n');
                ta.style.position = 'fixed';
                ta.style.opacity = '0';
                document.body.appendChild(ta);
                ta.select();
                try { document.execCommand('copy'); toast('日志已复制'); }
                catch (e) { toast('复制失败'); }
                document.body.removeChild(ta);
            }

            function toast(msg) {
                if (typeof mp !== 'undefined' && mp.ui && mp.ui.toast) mp.ui.toast(msg);
                else console.log('[CameraFaceTracking] ' + msg);
            }

            function cleanupAllObservers(reason) {
                if (!G.observers.length) return;
                var n = 0;
                for (var i = 0; i < G.observers.length; i++) {
                    try { if (scene && scene.onBeforeRenderObservable) scene.onBeforeRenderObservable.remove(G.observers[i]); n++; }
                    catch (e) { }
                }
                G.observers = [];
                renderObserver = null;
                if (reason) log('清理旧追踪循环 ' + n + ' 个（' + reason + '）');
            }

            // ===== 模型 =====

            function refreshModelList() {
                models = (typeof mp !== 'undefined' && mp.model && mp.model.list) ? mp.model.list() : [];
                log('发现 ' + models.length + ' 个模型');
                if (modelSelectEl) {
                    var currentVal = modelSelectEl.value;
                    modelSelectEl.innerHTML = '<option value="">-- 请选择模型 --</option>';
                    for (var i = 0; i < models.length; i++) {
                        var opt = document.createElement('option');
                        opt.value = models[i].id;
                        opt.textContent = models[i].name;
                        modelSelectEl.appendChild(opt);
                    }
                    modelSelectEl.value = currentVal;
                }
            }

            function findHeadRuntimeBone(modelId) {
                if (!ctx || !ctx.app || !ctx.app.getAnimationManager) { log('无法获取 AnimationManager'); return null; }
                var animMgr = ctx.app.getAnimationManager();
                if (!animMgr) { log('AnimationManager 为空'); return null; }
                var mmdModel = animMgr.getMmdModel(modelId);
                if (!mmdModel || !mmdModel.runtimeBones) { log('模型无 runtimeBones'); return null; }

                var bones = mmdModel.runtimeBones;
                log('模型 runtimeBones 数: ' + bones.length);
                var headKeywords = ['頭', '首', 'head', 'neck', 'ヘッド', 'ネック', 'あたま', '頭部', '頸'];
                for (var k = 0; k < headKeywords.length; k++) {
                    var kw = headKeywords[k].toLowerCase();
                    for (var i = 0; i < bones.length; i++) {
                        if ((bones[i].name || '').toLowerCase().indexOf(kw) !== -1) {
                            log('找到头部骨骼: ' + bones[i].name + ' (关键词: ' + headKeywords[k] + ')');
                            return bones[i];
                        }
                    }
                }
                log('未找到头部骨骼，列出前20个:');
                for (var j = 0; j < Math.min(bones.length, 20); j++) log('  - ' + bones[j].name);
                return null;
            }

            function getHeadWorldMatrix() {
                if (!headRuntimeBone) return null;
                try {
                    if (!tmpMatrix) tmpMatrix = new BABYLON.Matrix();
                    headRuntimeBone.getWorldMatrixToRef(tmpMatrix);
                    return tmpMatrix;
                } catch (e) {
                    log('获取头部矩阵失败: ' + e.message);
                    return null;
                }
            }

            function extractYaw(m) {
                return Math.atan2(m.m[8], m.m[10]);
            }

            // ===== MmdCamera =====

            function getCameraPose(cam) {
                if (!cam) return null;
                return {
                    tx: cam.target ? cam.target.x : 0,
                    ty: cam.target ? cam.target.y : 0,
                    tz: cam.target ? cam.target.z : 0,
                    yaw: cam.rotation ? cam.rotation.y : 0,
                    pitch: cam.rotation ? cam.rotation.x : 0,
                    radius: cam.distance ? Math.max(0.01, Math.abs(cam.distance)) : 10
                };
            }

            function applyCameraPose(cam, p) {
                if (!cam || !p) return;
                if (cam.target) {
                    if (cam.target.set) cam.target.set(p.tx, p.ty, p.tz);
                    else { cam.target.x = p.tx; cam.target.y = p.ty; cam.target.z = p.tz; }
                }
                if (cam.rotation) {
                    if (cam.rotation.set) cam.rotation.set(p.pitch, p.yaw, 0);
                    else { cam.rotation.x = p.pitch; cam.rotation.y = p.yaw; cam.rotation.z = 0; }
                }
                if (cam.distance !== undefined) cam.distance = -Math.max(0.01, p.radius);
                if (typeof cam.updatePosition === 'function') cam.updatePosition();
            }

            // ===== 绑定 / 解绑 =====

            function bindModel() {
                if (!selectedModelId) { toast('请先选择模型'); return; }
                if (isTracking) doUnbind(false);
                cleanupAllObservers('重新绑定');

                log('=== 开始绑定 ===');
                log('模型ID: ' + selectedModelId);

                headRuntimeBone = findHeadRuntimeBone(selectedModelId);
                if (!headRuntimeBone) {
                    toast('未找到头部骨骼');
                    isTracking = false; updateStatus(); return;
                }

                var cam = scene.activeCamera;
                log('相机类型: ' + (cam ? cam.getClassName() : 'null'));
                if (!cam) { toast('未找到相机'); return; }

                camInitPose = getCameraPose(cam);

                var hm0 = getHeadWorldMatrix();
                if (!tmpPos) tmpPos = new BABYLON.Vector3();
                var hx = camInitPose.tx, hy = camInitPose.ty, hz = camInitPose.tz;
                if (hm0) {
                    hm0.getTranslationToRef(tmpPos);
                    hx = tmpPos.x; hy = tmpPos.y; hz = tmpPos.z;
                    headInitYaw = extractYaw(hm0);
                    log('绑定瞬间头部: (' + hx.toFixed(2) + ', ' + hy.toFixed(2) + ', ' + hz.toFixed(2) +
                        ') | 头部yaw: ' + (headInitYaw / DEG).toFixed(1) + '°');
                }
                yawOffset = camInitPose.yaw - headInitYaw;

                log('相机初始: 距离 ' + camInitPose.radius.toFixed(2) +
                    ' | yaw ' + (camInitPose.yaw / DEG).toFixed(1) + '°' +
                    ' | pitch ' + (camInitPose.pitch / DEG).toFixed(1) + '°' +
                    ' | yaw偏移 ' + (yawOffset / DEG).toFixed(1) + '°');
                log('平滑: ' + (smoothEnabled ? 'One Euro 开启' : '关闭') +
                    ' | 位置截止 ' + smoothToCutoff(posSmooth).toFixed(2) + 'Hz' +
                    ' | 旋转截止 ' + smoothToCutoff(rotSmooth).toFixed(2) + 'Hz' +
                    ' | 防抖 ' + stableStrength.toFixed(2));

                // 初始化滤波器到当前真实值，避免开机飞位
                initFilters(hx, hy, hz, camInitPose.yaw);

                isTracking = true;
                frameCount = 0;
                startTracking();
                updateStatus();
                log('绑定成功，开始追踪');
                toast('绑定成功');
            }

            function doUnbind(restore) {
                var was = isTracking;
                isTracking = false;
                headRuntimeBone = null;
                filtersInited = false;
                cleanupAllObservers('解绑');
                if (restore !== false && camInitPose) {
                    var cam = scene.activeCamera;
                    if (cam) { applyCameraPose(cam, camInitPose); log('相机已恢复初始姿势'); }
                }
                camInitPose = null;
                if (was) log('已解绑');
                updateStatus();
            }

            function unbindModel() {
                if (!isTracking) {
                    cleanupAllObservers('强制清理');
                    updateStatus();
                    toast('已清理');
                    return;
                }
                doUnbind(true);
                toast('已解绑');
            }

            // ===== 每帧追踪 =====

            function startTracking() {
                if (!scene) return;
                cleanupAllObservers('启动新循环');

                renderObserver = scene.onBeforeRenderObservable.add(function () {
                    if (!isTracking || !headRuntimeBone || !camInitPose) return;

                    var hm = getHeadWorldMatrix();
                    if (!hm) return;
                    if (!tmpPos) tmpPos = new BABYLON.Vector3();
                    hm.getTranslationToRef(tmpPos);

                    var cam = scene.activeCamera;
                    if (!cam) return;

                    // 目标 yaw（跟随旋转）
                    var rawYaw = extractYaw(hm);
                    var targetYaw = followRotation ? rawYaw + yawOffset : camInitPose.yaw;

                    var outX = tmpPos.x, outY = tmpPos.y, outZ = tmpPos.z, outYaw = targetYaw;

                    if (smoothEnabled && filtersInited) {
                        var t = (typeof performance !== 'undefined' ? performance.now() : Date.now()) / 1000;

                        // 截止频率跟随滑块实时更新
                        fPosX.minCutoff = fPosY.minCutoff = fPosZ.minCutoff = smoothToCutoff(posSmooth);
                        fYaw.minCutoff = smoothToCutoff(rotSmooth);

                        // 死区阈值
                        var posDz = stableStrength * 0.30;            // 世界单位
                        var rotDz = stableStrength * 1.5 * DEG;     // 弧度

                        // 位置：以上一帧滤波输出为基准做死区
                        var pxPrev = fPosX.xf.s, pyPrev = fPosY.xf.s, pzPrev = fPosZ.xf.s;
                        var rx = tmpPos.x + applyDeadzone(tmpPos.x - pxPrev, posDz);
                        var ry = tmpPos.y + applyDeadzone(tmpPos.y - pyPrev, posDz);
                        var rz = tmpPos.z + applyDeadzone(tmpPos.z - pzPrev, posDz);

                        // yaw：先解环绕成连续角，再做角度死区
                        continuousYaw += angleDiff(targetYaw, continuousYaw);
                        var yawPrev = fYaw.xf.s;
                        var ryaw = yawPrev + applyDeadzone(angleDiff(continuousYaw, yawPrev), rotDz);

                        outX = fPosX.filter(rx, t);
                        outY = fPosY.filter(ry, t);
                        outZ = fPosZ.filter(rz, t);
                        outYaw = fYaw.filter(ryaw, t);
                    } else {
                        continuousYaw = targetYaw;
                    }

                    // ===== 视角坐标补偿 =====
                    var radius = camInitPose.radius * distScale;
                    var pitch = camInitPose.pitch + pitchOffsetDeg * DEG;
                    var targetY = outY + targetHeightOffset;

                    applyCameraPose(cam, {
                        tx: outX,
                        ty: targetY,
                        tz: outZ,
                        yaw: outYaw,
                        pitch: pitch,
                        radius: radius
                    });

                    frameCount++;
                    if (frameCount % 30 === 0) {
                        var cp = cam.position;
                        log('帧' + frameCount +
                            ' | 头: (' + tmpPos.x.toFixed(2) + ', ' + tmpPos.y.toFixed(2) + ', ' + tmpPos.z.toFixed(2) + ')' +
                            ' yaw ' + (rawYaw / DEG).toFixed(0) + '°' +
                            ' | 机: (' + cp.x.toFixed(2) + ', ' + cp.y.toFixed(2) + ', ' + cp.z.toFixed(2) + ')' +
                            ' yaw ' + (outYaw / DEG).toFixed(0) + '°' +
                            ' | 距离 ' + radius.toFixed(1) + ' pitch ' + (pitch / DEG).toFixed(0) + '°');

                        if (headInfoEl) {
                            headInfoEl.textContent = '头部: (' + tmpPos.x.toFixed(2) + ', ' + tmpPos.y.toFixed(2) + ', ' + tmpPos.z.toFixed(2) + ')';
                        }
                        if (camInfoEl) {
                            camInfoEl.textContent = '距离 ' + radius.toFixed(1) + ' · 俯仰 ' + (pitch / DEG).toFixed(0) + '° · 取景高 ' + targetHeightOffset.toFixed(1);
                        }
                        updateStatus();
                    }
                });

                G.observers.push(renderObserver);
                log('追踪循环已启动（注册表内共 ' + G.observers.length + ' 个）');
            }

            // ===== UI =====

            function updateStatus() {
                if (statusEl) {
                    statusEl.textContent = isTracking ? '状态: 追踪中' : '状态: 未绑定';
                    statusEl.style.color = isTracking ? '#4CAF50' : '#F44336';
                }
                if (bindBtnEl) bindBtnEl.disabled = isTracking;
                if (unbindBtnEl) unbindBtnEl.disabled = !isTracking;
            }

            function createButton(text, onClick, primary) {
                var b = document.createElement('button');
                b.textContent = text;
                b.style.cssText = 'padding:8px 16px;font-size:13px;border-radius:var(--radius-sm);cursor:pointer;flex:1;' +
                    (primary ? 'background:var(--color-primary,#4a90d9);color:#fff;border:none;' : '');
                b.addEventListener('click', onClick);
                return b;
            }

            function section(title) {
                var s = document.createElement('div');
                s.style.cssText = 'display:flex;flex-direction:column;gap:8px;padding:12px;background:var(--color-surface);border-radius:var(--radius-md);';
                if (title) {
                    var lab = document.createElement('div');
                    lab.style.cssText = 'font-size:12px;color:var(--text-secondary);font-weight:bold;';
                    lab.textContent = title;
                    s.appendChild(lab);
                }
                return s;
            }

            // 生成一行滑块；onInput(v, valSpan)
            function sliderRow(label, min, max, step, value, fmt, onInput) {
                var row = document.createElement('div');
                row.style.cssText = 'display:flex;flex-direction:column;gap:3px;';
                var head = document.createElement('div');
                head.style.cssText = 'display:flex;justify-content:space-between;font-size:11px;color:var(--text-secondary);';
                var lab = document.createElement('span');
                lab.textContent = label;
                var val = document.createElement('span');
                val.textContent = fmt(value);
                head.appendChild(lab);
                head.appendChild(val);
                row.appendChild(head);

                var input = document.createElement('input');
                input.type = 'range';
                input.min = String(min);
                input.max = String(max);
                input.step = String(step);
                input.value = String(value);
                input.style.cssText = 'width:100%;';
                input.addEventListener('input', function () {
                    var v = parseFloat(this.value);
                    val.textContent = fmt(v);
                    onInput(v);
                });
                row.appendChild(input);
                return row;
            }

            function checkboxRow(text, checked, onChange) {
                var row = document.createElement('div');
                row.style.cssText = 'display:flex;align-items:center;gap:8px;';
                var cb = document.createElement('input');
                cb.type = 'checkbox';
                cb.checked = checked;
                cb.addEventListener('change', function () { onChange(cb.checked); });
                var lab = document.createElement('label');
                lab.style.cssText = 'font-size:13px;cursor:pointer;';
                lab.textContent = text;
                lab.addEventListener('click', function () { cb.checked = !cb.checked; onChange(cb.checked); });
                row.appendChild(cb);
                row.appendChild(lab);
                return { row: row, cb: cb };
            }

            exports.createPanel = function (context, integrationOptions) {
                ctx = context;
                scene = context.scene;
                cleanupAllObservers('面板创建');

                integrationOptions = integrationOptions || {};

                log('=== 面部相机 V1.0 ===');
                refreshModelList();

                container = document.createElement('div');
                container.style.cssText = 'display:flex;flex-direction:column;height:100%;padding:12px;color:var(--text-primary);font-size:13px;gap:10px;overflow-y:auto;box-sizing:border-box;';

                // ===== 第1行：大标题 =====
                var title = document.createElement('div');
                title.style.cssText = 'font-size:18px;font-weight:bold;margin-bottom:2px;';
                title.textContent = '面部相机 V1.0';
                container.appendChild(title);

                // ===== 第2行：选择模型 =====
                var modelSec = section('选择模型');
                modelSelectEl = document.createElement('select');
                modelSelectEl.style.cssText = 'width:100%;padding:8px;font-size:13px;border-radius:var(--radius-sm);border:1px solid var(--color-border);background:var(--color-bg);color:var(--text-primary);';
                modelSelectEl.innerHTML = '<option value="">-- 请选择模型 --</option>';
                modelSelectEl.addEventListener('change', function () {
                    selectedModelId = this.value;
                    log('选择模型: ' + this.options[this.selectedIndex].text);
                });
                modelSec.appendChild(modelSelectEl);
                container.appendChild(modelSec);

                // ===== 第3行：面部相机绑定/解除绑定 =====
                var bindSec = document.createElement('div');
                bindSec.style.cssText = 'display:flex;gap:8px;';
                bindBtnEl = createButton('绑定头部', bindModel, true);
                unbindBtnEl = createButton('解除绑定', unbindModel);
                unbindBtnEl.disabled = true;
                bindSec.appendChild(bindBtnEl);
                bindSec.appendChild(unbindBtnEl);
                container.appendChild(bindSec);

                // ===== 第4行：目光跟随快捷开关（独立于面部相机模型） =====
                var gazeSec = section('目光跟随');
                var gazeRow = checkboxRow(
                    '启用目光跟随',
                    !!(integrationOptions.getGazeEnabled && integrationOptions.getGazeEnabled()),
                    function (v) {
                        try {
                            if (integrationOptions.setGazeEnabled) {
                                integrationOptions.setGazeEnabled(v);
                                log('目光跟随快捷开关: ' + (v ? '开启' : '关闭'));
                            }
                        } catch (e) {
                            log('目光跟随快捷开关失败: ' + (e && e.message ? e.message : e));
                            try { console.error('[FaceCamera] gaze toggle failed:', e); } catch (_) {}
                        }
                    }
                );
                var gazeEnableEl = gazeRow.cb;
                gazeSec.appendChild(gazeRow.row);

                var gazeHint = document.createElement('div');
                gazeHint.style.cssText = 'font-size:10px;color:var(--text-secondary);line-height:1.4;';
                gazeHint.textContent = '目光跟随拥有独立的目标模型；详细参数请切换到上方“目光跟随”页面调整。';
                gazeSec.appendChild(gazeHint);
                container.appendChild(gazeSec);

                // ===== 第5行开始：镜头运动补偿 =====
                var smoothSec = section('镜头运动补偿（防抖 / 惯性）');

                var se = checkboxRow('启用平滑（One Euro 滤波）', smoothEnabled, function (v) {
                    smoothEnabled = v;
                    log('运动平滑: ' + (v ? '开启' : '关闭'));
                });
                smoothEnableEl = se.cb;
                smoothSec.appendChild(se.row);

                smoothSec.appendChild(sliderRow('位置惯性（左=沉稳，右=灵敏）', 0.02, 1, 0.01, posSmooth,
                    function (v) { return v.toFixed(2); },
                    function (v) { posSmooth = v; }));

                smoothSec.appendChild(sliderRow('旋转惯性（左=缓慢，右=灵敏）', 0.02, 1, 0.01, rotSmooth,
                    function (v) { return v.toFixed(2); },
                    function (v) { rotSmooth = v; }));

                smoothSec.appendChild(sliderRow('防抖强度（冻结静止微抖）', 0, 1, 0.05, stableStrength,
                    function (v) { return v.toFixed(2); },
                    function (v) { stableStrength = v; }));

                var fr = checkboxRow('跟随角色旋转（转身时相机绕到正面）', followRotation, function (v) {
                    followRotation = v;
                    log('跟随旋转: ' + (v ? '开启' : '关闭'));
                });
                followRotEl = fr.cb;
                smoothSec.appendChild(fr.row);

                var smoothHint = document.createElement('div');
                smoothHint.style.cssText = 'font-size:10px;color:var(--text-secondary);line-height:1.4;';
                smoothHint.textContent = '防抖明显不足时可提高防抖强度；需要更跟手时可把位置/旋转惯性向右调。';
                smoothSec.appendChild(smoothHint);
                container.appendChild(smoothSec);

                // ===== 距离补偿 =====
                var compSec = section('距离补偿 / 视角补偿');

                compSec.appendChild(sliderRow('距离倍率（×推近/拉远）', 0.1, 2.5, 0.05, distScale,
                    function (v) { return '×' + v.toFixed(2); },
                    function (v) { distScale = v; }));

                compSec.appendChild(sliderRow('俯仰（负=机位升高俯拍，正=仰拍）', -45, 45, 1, pitchOffsetDeg,
                    function (v) { return v.toFixed(0) + '°'; },
                    function (v) { pitchOffsetDeg = v; }));

                compSec.appendChild(sliderRow('取景高度（注视点上下，负=看向身体）', -10, 10, 0.5, targetHeightOffset,
                    function (v) { return v.toFixed(1); },
                    function (v) { targetHeightOffset = v; }));

                var resetCompBtn = createButton('重置补偿', function () {
                    distScale = 1.0; pitchOffsetDeg = 0; targetHeightOffset = 0;
                    rebuildCompSliders();
                    toast('补偿已重置');
                });
                resetCompBtn.style.flex = '0 0 auto';
                resetCompBtn.style.padding = '6px 12px';
                var compBtnRow = document.createElement('div');
                compBtnRow.style.cssText = 'display:flex;';
                compBtnRow.appendChild(resetCompBtn);
                compSec.appendChild(compBtnRow);
                container.appendChild(compSec);

                function rebuildCompSliders() {
                    var inputs = compSec.querySelectorAll('input[type=range]');
                    if (inputs[0]) { inputs[0].value = String(distScale); inputs[0].dispatchEvent(new Event('input')); }
                    if (inputs[1]) { inputs[1].value = String(pitchOffsetDeg); inputs[1].dispatchEvent(new Event('input')); }
                    if (inputs[2]) { inputs[2].value = String(targetHeightOffset); inputs[2].dispatchEvent(new Event('input')); }
                }

                // ===== 状态 =====
                var statusSec = section('状态');
                statusEl = document.createElement('div');
                statusEl.style.cssText = 'font-size:13px;font-weight:bold;color:#F44336;';
                statusEl.textContent = '状态: 未绑定';
                statusSec.appendChild(statusEl);
                headInfoEl = document.createElement('div');
                headInfoEl.style.cssText = 'font-size:11px;color:var(--text-secondary);';
                headInfoEl.textContent = '头部: --';
                statusSec.appendChild(headInfoEl);
                camInfoEl = document.createElement('div');
                camInfoEl.style.cssText = 'font-size:11px;color:var(--text-secondary);';
                camInfoEl.textContent = '相机: --';
                statusSec.appendChild(camInfoEl);
                container.appendChild(statusSec);

                // ===== 最下方：折叠日志 =====
                var logWrap = document.createElement('details');
                logWrap.style.cssText = 'margin-top:2px;';
                var logSummary = document.createElement('summary');
                logSummary.style.cssText = 'cursor:pointer;color:var(--text-secondary);font-size:12px;padding:5px 0;';
                logSummary.textContent = '监测日志';
                logWrap.appendChild(logSummary);

                var logHeader = document.createElement('div');
                logHeader.style.cssText = 'display:flex;align-items:center;justify-content:flex-end;margin-bottom:4px;';
                var copyBtn = createButton('复制日志', copyLog);
                copyBtn.style.flex = '0 0 auto';
                copyBtn.style.padding = '4px 10px';
                logHeader.appendChild(copyBtn);
                logWrap.appendChild(logHeader);

                logPanelEl = document.createElement('div');
                logPanelEl.style.cssText = 'max-height:180px;overflow-y:auto;background:var(--color-bg);border-radius:var(--radius-sm);padding:8px;';
                logTextEl = document.createElement('div');
                logTextEl.style.cssText = 'white-space:pre-wrap;word-break:break-all;font-size:10px;font-family:monospace;color:var(--text-secondary);';
                logPanelEl.appendChild(logTextEl);
                logWrap.appendChild(logPanelEl);
                container.appendChild(logWrap);

                // 快捷开关状态同步函数
                container.__syncGazeToggle = function () {
                    try {
                        if (gazeEnableEl && integrationOptions.getGazeEnabled) {
                            gazeEnableEl.checked = !!integrationOptions.getGazeEnabled();
                        }
                    } catch (e) {}
                };

                updateStatus();
                return container;
            };

            exports.onShown = function () {
                refreshModelList();
                updateStatus();
                try {
                    if (container && container.__syncGazeToggle) container.__syncGazeToggle();
                } catch (e) {}
            };
            exports.onHidden = function () { };

            exports.dispose = function () {
                log('=== 插件卸载，清理追踪循环 ===');
                cleanupAllObservers('插件卸载');
                isTracking = false;
                headRuntimeBone = null;
                filtersInited = false;
                container = null; scene = null; ctx = null; models = [];
            };

        /* FACE_MODULE_END */
        return exports;
    }

export function createGazeFollowModule() {
        /* GAZE_MODULE_BEGIN */
        /**
         * 目光跟随相机插件 v2.1.5（彻底移除API依赖：手动四元数→矩阵+四元数求逆）
         *
         * 平台: MikuPlay Reburn (Babylon.js + babylon-mmd)
         *
         * v2.0.0 整合的10项约束:
         *   1. 只旋转、锁位置（只改rotationQuaternion，不动position）
         *   2. 父骨骼局部空间计算（眼球世界矩阵反推父级旋转）
         *   3. 固定上方向、限制roll（roll固定为0）
         *   4. 椭圆/软限位（上下独立最大角度，椭圆方程平滑缩放）
         *   5. 角速度、角加速度、EMA平滑、死区
         *   6. 摄像机距离衰减、最大距离、后方停止、NaN有效性检查
         *   7. 双眼会聚限制（最大会聚角）
         *   8. 无效时回中或保持（failRecovery模式）
         *   9. 每帧从默认旋转重新计算，不累加（baseQ=Identity）
         *  10. 异常回滚和更新顺序控制（onBeforeRender时机，连续失败回中）
         */



            // ===== 模块状态 =====
            var container = null;
            var scene = null;
            var ctx = null;

            var animObserver = null;
            var afterRenderObserver = null;
            var cachedHeadWorldRot = {};  // modelId -> 头部世界四元数（onAfterRender时缓存）
            var lastModelDebugInfo = '';  // 记录当前模型的诊断信息（mmd数量/head状态/缓存状态）
            var unsubscribers = [];

            var eyeCache = {};

            var curYaw = 0;
            var curPitch = 0;
            var curYawVel = 0;   // 约束5：角加速度跟踪（上一帧角速度）
            var curPitchVel = 0;
            var smoothCamPos = null;  // EMA 平滑后的相机位置，过滤镜头关键帧跳变
            var lastValidYaw = 0;    // 约束8/10：上一帧有效目标角度（异常回滚用）
            var lastValidPitch = 0;
            var consecutiveFails = 0; // 约束10：连续失败计数（超过阈值回中）

            var debugEl = null;
            var statusEl = null;

            var modelSelectEl = null;
            var leftBoneSelectEl = null;
            var rightBoneSelectEl = null;

            // ===== 默认设置（v2.0.0 整合10条约束）=====
            var defaults = {
                enabled: true,
                selectedModelId: '__all__',
                intensity: 1.0,
                // 约束4：椭圆/软限位（上下左右独立最大值，椭圆方程限制）
                maxYaw: 35,
                maxYawIn: 35,
                maxYawOut: 30,
                maxPitchUp: 25,
                maxPitchDown: 40,
                ellipseLimit: true,
                // 约束5：角速度、角加速度、平滑、死区
                smoothness: 0.35,
                angleSmooth: 0.25,
                maxAngleStep: 0.12,
                maxAngleAccel: 0.06,
                deadZone: 0.01,
                // 约束6：摄像机距离、后方、NaN检查
                minDistance: 2.5,
                maxDistance: 200,
                behindIgnore: true,
                // 约束7：双眼会聚限制
                convergence: 0,
                maxConvergence: 15,
                // 约束8：无效时回中或保持
                failRecovery: 'hold', // 'hold' 保持上一帧, 'center' 回中
                // 坐标系适配
                invertYaw: true,
                invertPitch: false,
                swapAxis: false,
                // 骨骼指定
                leftBoneName: '',
                rightBoneName: '',
                // 调试
                showDebug: true,
                // 手动微调
                manualYaw: 0,
                manualPitch: 0
            };

            var settings = {};
            function resetSettings() {
                settings = {};
                for (var k in defaults) {
                    if (defaults.hasOwnProperty(k)) settings[k] = defaults[k];
                }
            }
            resetSettings();

            // ===== 工具函数 =====
            function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
            function deg2rad(d) { return d * Math.PI / 180; }

            // 角度包裹到 [-PI, PI]，处理 π/-π 边界跳变
            function wrapAngle(a) {
                while (a > Math.PI) a -= 2 * Math.PI;
                while (a < -Math.PI) a += 2 * Math.PI;
                return a;
            }

            // 计算两个角度的最短差值（处理跨边界）
            function angleDiff(target, current) {
                return wrapAngle(target - current);
            }

            // 角度域单帧限幅：限制单帧最大变化量，抑制突变跳变
            function clampAngleStep(target, current, maxStep) {
                var diff = angleDiff(target, current);
                if (diff > maxStep) diff = maxStep;
                if (diff < -maxStep) diff = -maxStep;
                return current + diff;
            }

            function toast(msg, type) {
                try {
                    if (typeof mp === 'undefined' || !mp.ui || !mp.ui.toast) return;
                    var t = mp.ui.toast;
                    if (typeof t === 'function') { t(msg); return; }
                    var fn = (type && t[type]) || t.success || t.error;
                    if (fn) fn.call(t, msg);
                } catch (e) { }
            }

            // ===== UI 组件 =====
            function nativeSlider(label, min, max, value, step, onChange) {
                var row = document.createElement('div');
                row.style.cssText = 'display:flex;align-items:center;gap:8px;';
                var lbl = document.createElement('span');
                lbl.style.cssText = 'font-size:13px;color:var(--text-secondary);min-width:90px;flex-shrink:0;';
                lbl.textContent = label;
                var input = document.createElement('input');
                input.type = 'range'; input.min = String(min); input.max = String(max); input.step = String(step); input.value = String(value);
                input.style.cssText = 'flex:1;accent-color:var(--color-accent);';
                var val = document.createElement('span');
                val.style.cssText = 'font-size:12px;color:var(--text-primary);min-width:44px;text-align:right;';
                val.textContent = parseFloat(value).toFixed(2);
                input.addEventListener('input', function () {
                    var v = parseFloat(input.value);
                    val.textContent = v.toFixed(2);
                    onChange(v);
                });
                row.appendChild(lbl); row.appendChild(input); row.appendChild(val);
                return row;
            }

            function safeSlider(label, min, max, value, step, onChange) {
                try {
                    var s = new mp.ui.Slider(label, min, max, value, step);
                    s.onChange(onChange);
                    return s.getElement();
                } catch (e) {
                    return nativeSlider(label, min, max, value, step, onChange);
                }
            }

            function nativeToggle(label, value, onChange) {
                var row = document.createElement('div');
                row.style.cssText = 'display:flex;align-items:center;justify-content:space-between;';
                var lbl = document.createElement('span');
                lbl.style.cssText = 'font-size:13px;color:var(--text-secondary);';
                lbl.textContent = label;
                var input = document.createElement('input');
                input.type = 'checkbox'; input.checked = !!value;
                input.style.cssText = 'width:20px;height:20px;accent-color:var(--color-accent);';
                input.addEventListener('change', function () { onChange(input.checked); });
                row.appendChild(lbl); row.appendChild(input);
                return row;
            }

            function safeToggle(label, value, onChange) {
                try {
                    var t = new mp.ui.ToggleSwitch(label, value);
                    t.onChange(onChange);
                    return t.getElement();
                } catch (e) {
                    return nativeToggle(label, value, onChange);
                }
            }

            // ===== 模型与骨骼探测 =====
            function listModels() {
                try {
                    if (typeof mp !== 'undefined' && mp.model && typeof mp.model.list === 'function') {
                        return mp.model.list() || [];
                    }
                } catch (e) { }
                return [];
            }

            function getModelInfo(modelId) {
                if (!modelId || modelId === '__all__') return null;
                var models = listModels();
                for (var i = 0; i < models.length; i++) {
                    if (models[i] && String(models[i].id) === String(modelId)) return models[i];
                }
                return null;
            }

            function collectSkeletons(modelId) {
                var skeletons = [];
                var seen = {};
                var meshes = [];

                if (modelId === '__all__') {
                    if (scene && scene.meshes) {
                        for (var i = 0; i < scene.meshes.length; i++) {
                            var m = scene.meshes[i];
                            if (m && m.name && m.name.indexOf('__') !== 0 && m.name !== 'skyBox') {
                                meshes.push(m);
                            }
                        }
                    }
                } else {
                    var info = getModelInfo(modelId);
                    if (!info) return skeletons;
                    try {
                        if (info.container && info.container.meshes) {
                            for (var j = 0; j < info.container.meshes.length; j++) {
                                meshes.push(info.container.meshes[j]);
                            }
                        }
                    } catch (e) { }
                    try {
                        if (info.mesh) {
                            meshes.push(info.mesh);
                            var desc = info.mesh.getDescendants(true);
                            for (var k = 0; k < desc.length; k++) meshes.push(desc[k]);
                        }
                    } catch (e) { }
                }

                for (var mi = 0; mi < meshes.length; mi++) {
                    var mesh = meshes[mi];
                    if (!mesh || !mesh.skeleton) continue;
                    var sid = mesh.skeleton.uniqueId || mesh.skeleton.name || ('skel_' + mi);
                    if (seen[sid]) continue;
                    seen[sid] = true;
                    skeletons.push(mesh.skeleton);
                }
                return skeletons;
            }

            function listAllBoneNames(modelId) {
                var names = [];
                var seen = {};
                var skeletons = collectSkeletons(modelId);
                for (var i = 0; i < skeletons.length; i++) {
                    var bones = skeletons[i].bones || [];
                    for (var j = 0; j < bones.length; j++) {
                        var b = bones[j];
                        if (!b || !b.name) continue;
                        if (seen[b.name]) continue;
                        seen[b.name] = true;
                        names.push(b.name);
                    }
                }
                names.sort();
                return names;
            }

            function findBoneByName(skeletons, name) {
                if (!name) return null;
                for (var i = 0; i < skeletons.length; i++) {
                    var bones = skeletons[i].bones || [];
                    for (var j = 0; j < bones.length; j++) {
                        if (bones[j] && bones[j].name === name) return bones[j];
                    }
                }
                return null;
            }

            function detectEyeBone(skeletons, side) {
                var patterns;
                if (side === 'left') {
                    patterns = [
                        /^左目$/, /^目\s*[ＬL]$/, /^目_[ＬL]$/, /^目\s*左$/,
                        /^eye\s*[_\s]?l$/i, /^left\s*eye$/i, /^l\s*_?\s*eye$/i,
                        /^左眼$/, /^左\s*眼$/,
                        /^め\s*[ＬL]$/, /^め_/, /^瞳\s*[ＬL]$/,
                        /^eyeball\s*[_\s]?l$/i, /^眼球\s*左$/
                    ];
                } else {
                    patterns = [
                        /^右目$/, /^目\s*[ＲR]$/, /^目_[ＲR]$/, /^目\s*右$/,
                        /^eye\s*[_\s]?r$/i, /^right\s*eye$/i, /^r\s*_?\s*eye$/i,
                        /^右眼$/, /^右\s*眼$/,
                        /^め\s*[ＲR]$/, /^瞳\s*[ＲR]$/,
                        /^eyeball\s*[_\s]?r$/i, /^眼球\s*右$/
                    ];
                }

                for (var i = 0; i < skeletons.length; i++) {
                    var bones = skeletons[i].bones || [];
                    for (var j = 0; j < bones.length; j++) {
                        var b = bones[j];
                        if (!b || !b.name) continue;
                        var nm = b.name.trim();
                        for (var p = 0; p < patterns.length; p++) {
                            if (patterns[p].test(nm)) return b;
                        }
                    }
                }

                var kw = (side === 'left')
                    ? ['左目', '目Ｌ', '目L', 'Eye_L', 'eye_l', 'LeftEye', '左眼', 'めＬ', '瞳Ｌ', 'eyeball_l', '眼球左']
                    : ['右目', '目Ｒ', '目R', 'Eye_R', 'eye_r', 'RightEye', '右眼', 'めＲ', '瞳Ｒ', 'eyeball_r', '眼球右'];
                var exclude = /目頭|目尻|まばたき|瞬き|blink|眉|首|頭|体|親指|人差|中指|薬指|小指|足|腕|髪|肩|胸|腰|尻|ひざ|肘|手首|足首/;
                for (var i2 = 0; i2 < skeletons.length; i2++) {
                    var bones2 = skeletons[i2].bones || [];
                    for (var j2 = 0; j2 < bones2.length; j2++) {
                        var b2 = bones2[j2];
                        if (!b2 || !b2.name) continue;
                        var nm2 = b2.name;
                        if (exclude.test(nm2)) continue;
                        for (var k = 0; k < kw.length; k++) {
                            if (nm2.indexOf(kw[k]) !== -1) return b2;
                        }
                    }
                }
                return null;
            }

            function getEyeBones(modelId) {
                if (eyeCache[modelId]) return eyeCache[modelId];

                var skeletons = collectSkeletons(modelId);
                if (!skeletons.length) return null;

                // 获取关联的 mesh（用于 mesh 世界矩阵乘法）
                var modelMesh = null;
                try {
                    if (scene && scene.meshes) {
                        for (var mmi = 0; mmi < scene.meshes.length; mmi++) {
                            var mm = scene.meshes[mmi];
                            if (mm && mm.skeleton === skeletons[0]) {
                                modelMesh = mm;
                                break;
                            }
                        }
                    }
                } catch (e) { }

                var leftBone = null, rightBone = null;

                if (settings.leftBoneName) leftBone = findBoneByName(skeletons, settings.leftBoneName);
                if (settings.rightBoneName) rightBone = findBoneByName(skeletons, settings.rightBoneName);
                if (!leftBone) leftBone = detectEyeBone(skeletons, 'left');
                if (!rightBone) rightBone = detectEyeBone(skeletons, 'right');

                if (!leftBone && !rightBone) return null;

                // v2.0.9：对象探测——遍历 scene/mesh/bone 的所有属性，找到 runtimeBone 的真实挂载点
                var modelMeshes = scene ? (scene.meshes || []) : [];
                var probeInfo = probeObjectsForRuntime(scene, modelMeshes, leftBone || rightBone);

                // 同时查找 MmdModel 的 runtimeBones（用于获取世界位置）
                // v2.0.6：优先通过 BoneManager 单例获取（官方方式），回退到 scene 查找
                // v2.0.7：增加从 Babylon Bone 反向查找 IMmdRuntimeBone（bone.metadata/userData/属性）
                var mmdModels = findAllMmdModels(modelId);
                var leftRuntime = leftBone ? (getRuntimeBoneViaBoneManager(modelId, leftBone.name) || findRuntimeBone(mmdModels, leftBone.name) || findRuntimeBoneFromBabylonBone(leftBone)) : null;
                var rightRuntime = rightBone ? (getRuntimeBoneViaBoneManager(modelId, rightBone.name) || findRuntimeBone(mmdModels, rightBone.name) || findRuntimeBoneFromBabylonBone(rightBone)) : null;

                // v2.0.1：直接查找头部骨骼（"頭"），用头部世界矩阵获取父级旋转
                // 不再用"眼球世界矩阵反推父级旋转"——因为导入动作后 bone.rotationQuaternion
                // 被动作覆盖，反推时读到的是上一帧插件设置的值，导致父级旋转计算错误。
                var headRuntime = null;
                var headBone = null;
                // 宽松关键词匹配（包含即可，不要求精确匹配）
                var headKeywords = ['頭', '首', 'head', 'neck', 'ヘッド', 'ネック', 'あたま', '頭部', '頸'];
                function isHeadBoneName(name) {
                    if (!name) return false;
                    var lower = name.toLowerCase();
                    for (var hk = 0; hk < headKeywords.length; hk++) {
                        if (lower.indexOf(headKeywords[hk].toLowerCase()) !== -1) return true;
                    }
                    return false;
                }

                // 方式A（最可靠）：从眼球骨骼的父级链向上查找头部骨骼
                // 眼球一定是头部的子骨骼，向上遍历必然能找到
                var refEyeBone = leftBone || rightBone;
                if (refEyeBone) {
                    try {
                        var p = (typeof refEyeBone.getParent === 'function') ? refEyeBone.getParent() : refEyeBone.parent;
                        var guard = 0;
                        while (p && guard < 50) {
                            if (p.name && isHeadBoneName(p.name)) {
                                headBone = p;
                                break;
                            }
                            p = (typeof p.getParent === 'function') ? p.getParent() : p.parent;
                            guard++;
                        }
                    } catch (e) { }
                }

                // 方式B（v2.0.6最优先）：通过 BoneManager 单例按关键词查找头部骨骼
                if (!headRuntime) {
                    var bm = findBoneManager();
                    if (bm) {
                        for (var hk2 = 0; hk2 < headKeywords.length; hk2++) {
                            try {
                                var hb2 = bm.getBone(modelId, headKeywords[hk2]);
                                if (hb2 && typeof hb2.getWorldMatrixToRef === 'function') {
                                    headRuntime = hb2;
                                    break;
                                }
                            } catch (e) { }
                        }
                    }
                }

                // 方式C：在 runtimeBones 中按关键词查找
                if (!headRuntime) {
                    for (var hm = 0; hm < mmdModels.length; hm++) {
                        var rbones = mmdModels[hm].runtimeBones || [];
                        for (var hb = 0; hb < rbones.length; hb++) {
                            var rbn = rbones[hb];
                            if (rbn && rbn.name && isHeadBoneName(rbn.name)) {
                                headRuntime = rbn;
                                break;
                            }
                        }
                        if (headRuntime) break;
                    }
                }

                // 方式C：在 Babylon bones 中按关键词查找（如果方式A没找到）
                if (!headBone) {
                    for (var sk = 0; sk < skeletons.length; sk++) {
                        var bones = skeletons[sk].bones || [];
                        for (var bn = 0; bn < bones.length; bn++) {
                            if (bones[bn] && bones[bn].name && isHeadBoneName(bones[bn].name)) {
                                headBone = bones[bn];
                                break;
                            }
                        }
                        if (headBone) break;
                    }
                }

                // 如果找到了 Babylon headBone 但没找到 runtime，尝试按名字在 runtime 中找
                // v2.0.7：增加从 Babylon Bone 反向查找 IMmdRuntimeBone
                if (headBone && !headRuntime) {
                    headRuntime = findRuntimeBone(mmdModels, headBone.name) || findRuntimeBoneFromBabylonBone(headBone);
                }

                // 保存骨骼原始旋转（首次检测时，未被插件修改过的值）
                // 关键：每帧用原始旋转+偏移，避免偏移不断累积
                function captureOrigQ(bone) {
                    if (!bone) return null;
                    try {
                        if (bone.rotationQuaternion) return bone.rotationQuaternion.clone();
                        return BABYLON.Quaternion.FromEulerAngles(
                            bone.rotation ? bone.rotation.x : 0,
                            bone.rotation ? bone.rotation.y : 0,
                            bone.rotation ? bone.rotation.z : 0
                        );
                    } catch (e) { return BABYLON.Quaternion.Identity(); }
                }

                eyeCache[modelId] = {
                    left: leftBone,
                    right: rightBone,
                    leftRuntime: leftRuntime,
                    rightRuntime: rightRuntime,
                    headRuntime: headRuntime,
                    headBone: headBone,
                    mmdModels: mmdModels,
                    skeleton: skeletons.length ? skeletons[0] : null,
                    mesh: modelMesh,
                    leftName: leftBone ? leftBone.name : '',
                    rightName: rightBone ? rightBone.name : '',
                    leftOrigQ: captureOrigQ(leftBone),
                    rightOrigQ: captureOrigQ(rightBone),
                    probeInfo: probeInfo
                };
                return eyeCache[modelId];
            }

            function clearEyeCache() {
                eyeCache = {};
            }

            // ===== MMD 运行时骨骼位置获取 =====
            // MikuPlay 使用 babylon-mmd，骨骼世界位置必须用 IMmdRuntimeBone.getWorldMatrixToRef()
            // 标准 Babylon Bone.getAbsolutePosition() 在 MMD 运行时中返回 (0,0,0)

            // v2.0.6：优先通过 BoneManager 单例获取 IMmdRuntimeBone（官方方式）
            // 官方 BoneManager.getInstance().getBone(modelId, boneName) 返回 IMmdRuntimeBone
            // 官方代码在 onBeforeRender 中直接用 bone.getWorldMatrixToRef() 获取世界矩阵
            var cachedBoneManager = null;
            var boneManagerSearched = false;

            function findBoneManager() {
                if (boneManagerSearched) return cachedBoneManager;
                boneManagerSearched = true;
                try {
                    // 方式1：检查常见全局挂载点
                    var globalKeys = ['BoneManager', 'boneManager', 'boneMgr'];
                    for (var gk = 0; gk < globalKeys.length; gk++) {
                        try {
                            var gv = (typeof window !== 'undefined') ? window[globalKeys[gk]] : null;
                            if (gv && typeof gv === 'object' && typeof gv.getBone === 'function') {
                                cachedBoneManager = gv;
                                return gv;
                            }
                            if (gv && typeof gv.getInstance === 'function') {
                                var inst = gv.getInstance();
                                if (inst && typeof inst.getBone === 'function') {
                                    cachedBoneManager = inst;
                                    return inst;
                                }
                            }
                        } catch (e) { }
                    }
                    // 方式2：检查 mp 全局对象
                    if (typeof mp !== 'undefined') {
                        var mpKeys = ['boneManager', 'BoneManager', 'bone', 'bones'];
                        for (var mk = 0; mk < mpKeys.length; mk++) {
                            try {
                                var mv = mp[mpKeys[mk]];
                                if (mv && typeof mv === 'object' && typeof mv.getBone === 'function') {
                                    cachedBoneManager = mv;
                                    return mv;
                                }
                            } catch (e) { }
                        }
                    }
                    // 方式3：遍历 window 的所有属性，找有 getBone 方法的对象
                    if (typeof window !== 'undefined') {
                        for (var key in window) {
                            try {
                                var val = window[key];
                                if (val && typeof val === 'object' && typeof val.getBone === 'function' && key !== 'window') {
                                    cachedBoneManager = val;
                                    return val;
                                }
                                if (val && typeof val === 'function' && val.getInstance) {
                                    try {
                                        var inst2 = val.getInstance();
                                        if (inst2 && typeof inst2.getBone === 'function') {
                                            cachedBoneManager = inst2;
                                            return inst2;
                                        }
                                    } catch (e) { }
                                }
                            } catch (e) { }
                        }
                    }
                } catch (e) { }
                return null;
            }

            // 通过 BoneManager 获取 IMmdRuntimeBone
            function getRuntimeBoneViaBoneManager(modelId, boneName) {
                var bm = findBoneManager();
                if (!bm || !boneName) return null;
                try {
                    var bone = bm.getBone(modelId, boneName);
                    if (bone && typeof bone.getWorldMatrixToRef === 'function') return bone;
                } catch (e) { }
                return null;
            }

            // v2.0.7：从 Babylon Bone 反向查找 IMmdRuntimeBone
            // 官方代码中 IMmdRuntimeBone.linkedBone 指向 Babylon Bone
            // 反向引用可能存在于 bone.metadata / bone.userData / bone._runtimeBone 等属性中
            function findRuntimeBoneFromBabylonBone(babylonBone) {
                if (!babylonBone) return null;
                try {
                    // 方式1：检查常见属性名
                    var directProps = ['runtimeBone', '_runtimeBone', 'mmdRuntimeBone', 'mmdBone', 'linkedRuntimeBone'];
                    for (var dp = 0; dp < directProps.length; dp++) {
                        try {
                            var val = babylonBone[directProps[dp]];
                            if (val && typeof val === 'object' && typeof val.getWorldMatrixToRef === 'function') {
                                return val;
                            }
                        } catch (e) { }
                    }
                    // 方式2：检查 metadata / userData
                    var metaSources = [babylonBone.metadata, babylonBone.userData, babylonBone._metadata, babylonBone._userData];
                    for (var ms = 0; ms < metaSources.length; ms++) {
                        var meta = metaSources[ms];
                        if (meta && typeof meta === 'object') {
                            for (var mk in meta) {
                                try {
                                    var mv = meta[mk];
                                    if (mv && typeof mv === 'object' && typeof mv.getWorldMatrixToRef === 'function') {
                                        return mv;
                                    }
                                } catch (e) { }
                            }
                        }
                    }
                    // 方式3：遍历 bone 的所有可枚举属性，找有 getWorldMatrixToRef 的对象
                    for (var key in babylonBone) {
                        try {
                            var bv = babylonBone[key];
                            if (bv && typeof bv === 'object' && typeof bv.getWorldMatrixToRef === 'function' && bv !== babylonBone) {
                                return bv;
                            }
                        } catch (e) { }
                    }
                    // 方式4：检查 bone 的非枚举属性（通过 Object.getOwnPropertyNames）
                    try {
                        var props = Object.getOwnPropertyNames(babylonBone);
                        for (var pi = 0; pi < props.length; pi++) {
                            try {
                                var pv = babylonBone[props[pi]];
                                if (pv && typeof pv === 'object' && typeof pv.getWorldMatrixToRef === 'function') {
                                    return pv;
                                }
                            } catch (e) { }
                        }
                    } catch (e) { }
                } catch (e) { }
                return null;
            }

            // v2.0.9：对象探测——遍历 scene/mesh/bone 的所有属性，找到 runtimeBone/MmdModel 的真实挂载点
            function probeObjectsForRuntime(scn, meshes, sampleBone) {
                var result = { meshProps: '', boneProps: '', sceneProps: '', foundMmd: '', foundRt: '', foundRuntime: '' };
                try {
                    // ===== 探测 scene 的所有属性（MmdRuntime.register(scene) 很可能挂在这里）=====
                    if (scn) {
                        var scenePropList = [];
                        for (var skey in scn) {
                            try {
                                var sval = scn[skey];
                                if (sval && typeof sval === 'object') {
                                    // 检查是否有 mmdModels（MmdRuntime）
                                    if (sval.mmdModels || typeof sval.createMmdModel === 'function') {
                                        result.foundRuntime = 'scene.' + skey;
                                        scenePropList.push(skey + '(runtime!)');
                                    }
                                    // 检查是否有 runtimeBones（MmdModel）
                                    else if (sval.runtimeBones) {
                                        result.foundMmd = 'scene.' + skey;
                                        scenePropList.push(skey + '(mmd!)');
                                    }
                                    else if (skey.indexOf('mmd') !== -1 || skey.indexOf('runtime') !== -1) {
                                        scenePropList.push(skey + '?');
                                    }
                                }
                            } catch (e) { }
                        }
                        // 检查 scene.metadata / userData
                        var sceneMetaSources = [scn.metadata, scn.userData];
                        for (var sms = 0; sms < sceneMetaSources.length; sms++) {
                            var smeta = sceneMetaSources[sms];
                            if (smeta && typeof smeta === 'object') {
                                for (var smk in smeta) {
                                    try {
                                        var smv = smeta[smk];
                                        if (smv && typeof smv === 'object') {
                                            if (smv.mmdModels || typeof smv.createMmdModel === 'function') {
                                                result.foundRuntime = 'scene.meta.' + smk;
                                                scenePropList.push('meta.' + smk + '(runtime!)');
                                            } else if (smv.runtimeBones) {
                                                result.foundMmd = 'scene.meta.' + smk;
                                                scenePropList.push('meta.' + smk + '(mmd!)');
                                            }
                                        }
                                    } catch (e) { }
                                }
                            }
                        }
                        result.sceneProps = scenePropList.slice(0, 15).join(',');
                    }
                    // 探测第一个 mesh 的所有属性
                    if (meshes && meshes.length > 0) {
                        var mesh = meshes[0];
                        var propList = [];
                        for (var key in mesh) {
                            try {
                                var val = mesh[key];
                                if (val && typeof val === 'object') {
                                    // 检查是否有 runtimeBones（MmdModel）
                                    if (val.runtimeBones) {
                                        result.foundMmd = 'mesh.' + key;
                                        propList.push(key + '(mmd!)');
                                    }
                                    // 检查是否有 getWorldMatrixToRef（IMmdRuntimeBone）
                                    else if (typeof val.getWorldMatrixToRef === 'function') {
                                        result.foundRt = 'mesh.' + key;
                                        propList.push(key + '(rt!)');
                                    }
                                    else if (key.indexOf('mmd') !== -1 || key.indexOf('runtime') !== -1 || key.indexOf('bone') !== -1) {
                                        propList.push(key + '?');
                                    }
                                }
                            } catch (e) { }
                        }
                        // 也检查 mesh.metadata / userData
                        var metaSources = [mesh.metadata, mesh.userData];
                        for (var ms = 0; ms < metaSources.length; ms++) {
                            var meta = metaSources[ms];
                            if (meta && typeof meta === 'object') {
                                for (var mk in meta) {
                                    try {
                                        var mv = meta[mk];
                                        if (mv && typeof mv === 'object') {
                                            if (mv.runtimeBones) {
                                                result.foundMmd = 'mesh.meta.' + mk;
                                                propList.push('meta.' + mk + '(mmd!)');
                                            } else if (typeof mv.getWorldMatrixToRef === 'function') {
                                                result.foundRt = 'mesh.meta.' + mk;
                                                propList.push('meta.' + mk + '(rt!)');
                                            }
                                        }
                                    } catch (e) { }
                                }
                            }
                        }
                        result.meshProps = propList.slice(0, 15).join(',');
                    }
                    // 探测 sampleBone 的所有属性
                    if (sampleBone) {
                        var bonePropList = [];
                        for (var bkey in sampleBone) {
                            try {
                                var bval = sampleBone[bkey];
                                if (bval && typeof bval === 'object') {
                                    if (typeof bval.getWorldMatrixToRef === 'function') {
                                        result.foundRt = 'bone.' + bkey;
                                        bonePropList.push(bkey + '(rt!)');
                                    } else if (bval.runtimeBones) {
                                        result.foundMmd = 'bone.' + bkey;
                                        bonePropList.push(bkey + '(mmd!)');
                                    } else if (bkey.indexOf('mmd') !== -1 || bkey.indexOf('runtime') !== -1 || bkey.indexOf('linked') !== -1) {
                                        bonePropList.push(bkey + '?');
                                    }
                                }
                            } catch (e) { }
                        }
                        // 检查 bone.metadata / userData
                        var bMetaSources = [sampleBone.metadata, sampleBone.userData];
                        for (var bms = 0; bms < bMetaSources.length; bms++) {
                            var bmeta = bMetaSources[bms];
                            if (bmeta && typeof bmeta === 'object') {
                                for (var bmk in bmeta) {
                                    try {
                                        var bmv = bmeta[bmk];
                                        if (bmv && typeof bmv === 'object') {
                                            if (typeof bmv.getWorldMatrixToRef === 'function') {
                                                result.foundRt = 'bone.meta.' + bmk;
                                                bonePropList.push('meta.' + bmk + '(rt!)');
                                            }
                                        }
                                    } catch (e) { }
                                }
                            }
                        }
                        result.boneProps = bonePropList.slice(0, 15).join(',');
                    }
                } catch (e) { }
                return result;
            }

            // 缓存 MmdRuntime 查找结果（每帧查找开销大）
            var cachedMmdRuntime = null;
            var cachedMmdRuntimeScene = null;

            // 从 scene 中查找 MmdRuntime 实例（babylon-mmd 运行时）
            // MmdRuntime.register(scene) 会注册 onAfterAnimationsObservable 回调并保存 scene 引用
            function findMmdRuntime(scn) {
                if (cachedMmdRuntime && cachedMmdRuntimeScene === scn) return cachedMmdRuntime;
                cachedMmdRuntimeScene = scn;
                cachedMmdRuntime = null;
                if (!scn) return null;
                try {
                    // 方式0：直接检查常见挂载点
                    var directKeys = ['mmdRuntime', '_mmdRuntime', 'mmd', 'mmdPlayer', 'runtime'];
                    for (var dk = 0; dk < directKeys.length; dk++) {
                        try {
                            var dv = scn[directKeys[dk]];
                            if (dv && typeof dv === 'object' &&
                                (typeof dv.createMmdModel === 'function' || dv.mmdModels || typeof val.register === 'function')) {
                                cachedMmdRuntime = dv;
                                return dv;
                            }
                        } catch (e) { }
                    }
                    // 方式1：遍历 scene 的所有属性（包括不可枚举），找有 MmdRuntime 特征方法的对象
                    var keys = Object.getOwnPropertyNames(scn);
                    for (var i = 0; i < keys.length; i++) {
                        try {
                            var val = scn[keys[i]];
                            if (val && typeof val === 'object') {
                                if (typeof val.createMmdModel === 'function' ||
                                    typeof val.getBoneWorldMatrixArena === 'function' ||
                                    (val.mmdModels && typeof val.mmdModels.get === 'function')) {
                                    cachedMmdRuntime = val;
                                    return val;
                                }
                            }
                        } catch (e) { }
                    }
                    // 方式2：从 onAfterAnimationsObservable 的观察者回调中查找
                    if (scn.onAfterAnimationsObservable && scn.onAfterAnimationsObservable.observers) {
                        var obs = scn.onAfterAnimationsObservable.observers;
                        for (var j = 0; j < obs.length; j++) {
                            try {
                                var cb = obs[j].callback;
                                if (cb && cb._mmdRuntime) {
                                    cachedMmdRuntime = cb._mmdRuntime;
                                    return cb._mmdRuntime;
                                }
                            } catch (e) { }
                        }
                    }
                    // 方式3：从 scene.meshes 中找有 runtime/mmdModel 属性的 mesh，其 runtime 可能是 MmdModel
                    if (scn.meshes) {
                        for (var mi = 0; mi < scn.meshes.length; mi++) {
                            var m = scn.meshes[mi];
                            if (m && m.runtime && m.runtime.runtimeBones) {
                                // m.runtime 是 MmdModel，不是 MmdRuntime，但可以直接用
                                // 我们需要的是 MmdModel，所以这里不缓存为 runtime
                            }
                        }
                    }
                } catch (e) { }
                return null;
            }

            // 从 MmdRuntime 获取所有 MmdModel
            function getMmdModelsFromRuntime(rt) {
                var models = [];
                if (!rt) return models;
                try {
                    if (rt.mmdModels) {
                        if (typeof rt.mmdModels.forEach === 'function') {
                            rt.mmdModels.forEach(function (m) { models.push(m); });
                        } else if (typeof rt.mmdModels.values === 'function') {
                            var iter = rt.mmdModels.values();
                            var item;
                            while ((item = iter.next()) && !item.done) {
                                if (item.value) models.push(item.value);
                            }
                        }
                    }
                } catch (e) { }
                return models;
            }

            // 从 mesh 中查找 MmdModel（babylon-mmd 运行时模型）
            function findMmdModel(mesh) {
                if (!mesh) return null;
                try {
                    // 常见挂载位置
                    if (mesh.mmdModel) return mesh.mmdModel;
                    if (mesh._mmdModel) return mesh._mmdModel;
                    if (mesh.metadata && mesh.metadata.mmdModel) return mesh.metadata.mmdModel;
                    // MmdMesh 类型可能有 runtime 引用
                    if (mesh.runtime) return mesh.runtime;
                } catch (e) { }
                return null;
            }

            // 从模型中查找所有 MmdModel
            function findAllMmdModels(modelId) {
                var models = [];
                var seen = {};
                try {
                    // 方式1（最优先）：从 scene 的 MmdRuntime 获取所有 MmdModel
                    var rt = findMmdRuntime(scene);
                    if (rt) {
                        var rtModels = getMmdModelsFromRuntime(rt);
                        for (var ri = 0; ri < rtModels.length; ri++) {
                            var rm = rtModels[ri];
                            if (rm && rm.runtimeBones) {
                                var rkey = rm.uniqueId || rm.id || ('rt_' + ri);
                                if (!seen[rkey]) {
                                    seen[rkey] = true;
                                    models.push(rm);
                                }
                            }
                        }
                    }
                    // 方式2：从 mesh 属性中查找
                    var info = getModelInfo(modelId);
                    if (info) {
                        var meshes = [];
                        if (info.container && info.container.meshes) {
                            for (var j = 0; j < info.container.meshes.length; j++) {
                                meshes.push(info.container.meshes[j]);
                            }
                        }
                        if (info.mesh) {
                            meshes.push(info.mesh);
                            try {
                                var desc = info.mesh.getDescendants(true);
                                for (var k = 0; k < desc.length; k++) meshes.push(desc[k]);
                            } catch (e) { }
                        }
                        for (var mi = 0; mi < meshes.length; mi++) {
                            var mm = findMmdModel(meshes[mi]);
                            if (mm && mm.runtimeBones) {
                                var key = mm.uniqueId || mm.id || ('mm_' + mi);
                                if (!seen[key]) {
                                    seen[key] = true;
                                    models.push(mm);
                                }
                            }
                        }
                    }
                    // 方式3：直接遍历 scene.meshes，找有 runtime 属性且 runtime.runtimeBones 存在的 mesh
                    // MikuPlay 中 MmdModel 可能直接挂在 mesh.runtime 上
                    if (scene && scene.meshes) {
                        for (var si = 0; si < scene.meshes.length; si++) {
                            var sm = scene.meshes[si];
                            if (sm && sm.runtime && sm.runtime.runtimeBones) {
                                var skey = sm.runtime.uniqueId || sm.runtime.id || ('scene_' + si);
                                if (!seen[skey]) {
                                    seen[skey] = true;
                                    models.push(sm.runtime);
                                }
                            }
                            // 也检查 mesh.mmdModel / mesh._mmdModel
                            if (sm && sm.mmdModel && sm.mmdModel.runtimeBones) {
                                var mkey = sm.mmdModel.uniqueId || sm.mmdModel.id || ('mmd_' + si);
                                if (!seen[mkey]) {
                                    seen[mkey] = true;
                                    models.push(sm.mmdModel);
                                }
                            }
                            // 方式3b：遍历 mesh 的所有属性（包括 metadata/userData/_metadata），找有 runtimeBones 的对象
                            try {
                                var propSources = [sm.metadata, sm.userData, sm._metadata, sm._userData];
                                for (var ps = 0; ps < propSources.length; ps++) {
                                    var psrc = propSources[ps];
                                    if (psrc && typeof psrc === 'object') {
                                        for (var pk in psrc) {
                                            var pval = psrc[pk];
                                            if (pval && pval.runtimeBones) {
                                                var pkey = pval.uniqueId || pval.id || ('meta_' + si + '_' + pk);
                                                if (!seen[pkey]) {
                                                    seen[pkey] = true;
                                                    models.push(pval);
                                                }
                                            }
                                        }
                                    }
                                }
                            } catch (e) { }
                            // 方式3c：遍历 mesh 自身的可枚举属性，找有 runtimeBones 的对象
                            try {
                                for (var mk in sm) {
                                    try {
                                        var mval = sm[mk];
                                        if (mval && typeof mval === 'object' && mval.runtimeBones && mval !== sm) {
                                            var mkey2 = mval.uniqueId || mval.id || ('prop_' + si + '_' + mk);
                                            if (!seen[mkey2]) {
                                                seen[mkey2] = true;
                                                models.push(mval);
                                            }
                                        }
                                    } catch (e) { }
                                }
                            } catch (e) { }
                        }
                    }
                    // 方式4：从 mp 全局对象中查找 MmdRuntime/MmdModel
                    try {
                        if (typeof mp !== 'undefined') {
                            var mpKeys = ['mmd', 'mmdRuntime', 'runtime', 'model', 'models'];
                            for (var mk2 = 0; mk2 < mpKeys.length; mk2++) {
                                var mpVal = mp[mpKeys[mk2]];
                                if (mpVal && typeof mpVal === 'object') {
                                    if (mpVal.runtimeBones) {
                                        var mpKey = mpVal.uniqueId || mpVal.id || ('mp_' + mpKeys[mk2]);
                                        if (!seen[mpKey]) { seen[mpKey] = true; models.push(mpVal); }
                                    }
                                    if (mpVal.mmdModels) {
                                        var rtModels2 = getMmdModelsFromRuntime(mpVal);
                                        for (var rmi = 0; rmi < rtModels2.length; rmi++) {
                                            if (rtModels2[rmi] && rtModels2[rmi].runtimeBones) {
                                                var rkey2 = rtModels2[rmi].uniqueId || rtModels2[rmi].id || ('mpRT_' + rmi);
                                                if (!seen[rkey2]) { seen[rkey2] = true; models.push(rtModels2[rmi]); }
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    } catch (e) { }
                } catch (e) { }
                return models;
            }

            // 按名称在 MmdModel.runtimeBones 中查找 IMmdRuntimeBone
            function findRuntimeBone(mmdModels, name) {
                if (!name || !mmdModels) return null;
                for (var i = 0; i < mmdModels.length; i++) {
                    var bones = mmdModels[i].runtimeBones || [];
                    for (var j = 0; j < bones.length; j++) {
                        if (bones[j] && bones[j].name === name) return bones[j];
                    }
                }
                return null;
            }

            // 用 IMmdRuntimeBone 获取世界位置（MikuPlay 官方方式）
            function getRuntimeBoneWorldPosition(runtimeBone) {
                if (!runtimeBone) return null;
                try {
                    if (typeof runtimeBone.getWorldMatrixToRef === 'function') {
                        var m = new BABYLON.Matrix();
                        runtimeBone.getWorldMatrixToRef(m);
                        var pos = new BABYLON.Vector3();
                        m.getTranslationToRef(pos);
                        if (pos && (pos.x !== 0 || pos.y !== 0 || pos.z !== 0)) {
                            return pos;
                        }
                    }
                } catch (e) { }
                // 回退：如果 runtimeBone 有 linkedBone，尝试标准方式
                try {
                    if (runtimeBone.linkedBone) {
                        var lb = runtimeBone.linkedBone;
                        if (lb.getAbsolutePosition) {
                            var p2 = lb.getAbsolutePosition();
                            if (p2 && (p2.x !== 0 || p2.y !== 0 || p2.z !== 0)) return p2;
                        }
                    }
                } catch (e) { }
                return null;
            }

            // v2.1.5：手动将四元数转换为旋转矩阵（不依赖 Babylon.js API，兼容旧版本）
            // 标准四元数到旋转矩阵的转换公式
            function quaternionToMatrix(q) {
                var x = q.x, y = q.y, z = q.z, w = q.w;
                var x2 = x + x, y2 = y + y, z2 = z + z;
                var xx = x * x2, xy = x * y2, xz = x * z2;
                var yy = y * y2, yz = y * z2, zz = z * z2;
                var wx = w * x2, wy = w * y2, wz = w * z2;
                var m = new BABYLON.Matrix();
                var arr = m.m;
                arr[0] = 1 - (yy + zz);
                arr[1] = xy + wz;
                arr[2] = xz - wy;
                arr[3] = 0;
                arr[4] = xy - wz;
                arr[5] = 1 - (xx + zz);
                arr[6] = yz + wx;
                arr[7] = 0;
                arr[8] = xz + wy;
                arr[9] = yz - wx;
                arr[10] = 1 - (xx + yy);
                arr[11] = 0;
                arr[12] = 0;
                arr[13] = 0;
                arr[14] = 0;
                arr[15] = 1;
                return m;
            }

            // v2.1.5：手动计算四元数的逆（单位四元数的逆就是共轭）
            function quaternionInverse(q) {
                // 假设是单位四元数（我们在getBoneWorldMatrixManual中已归一化）
                return new BABYLON.Quaternion(-q.x, -q.y, -q.z, q.w);
            }

            // v2.1.2：手动从骨骼父级链累加计算完整世界矩阵（含旋转）
            // 已验证：getBoneWorldPositionManual 的 getTranslation() 有效（eye=...[manual]）
            // 因此同一个矩阵的旋转部分也一定有效！直接用于获取头部世界旋转。
            // 包含整条父级链（头部→颈部→上半身→下半身→根节点），身体旋转自动生效。
            // 返回 {matrix, error}，便于调试具体失败原因。
            function getBoneWorldMatrixManual(bone, mesh) {
                if (!bone) return { matrix: null, error: 'boneNull' };
                try {
                    var chain = [];
                    var b = bone;
                    var guard = 0;
                    while (b && guard < 100) {
                        chain.unshift(b);
                        b = (typeof b.getParent === 'function') ? b.getParent() : b.parent;
                        guard++;
                    }
                    if (!chain.length) return { matrix: null, error: 'emptyChain' };
                    var worldMat = BABYLON.Matrix.Identity();
                    for (var i = 0; i < chain.length; i++) {
                        var cb = chain[i];
                        var pos = cb.position ? cb.position.clone() : BABYLON.Vector3.Zero();
                        var rot = cb.rotationQuaternion ? cb.rotationQuaternion.clone() :
                                  (cb.rotation ? BABYLON.Quaternion.FromEulerAngles(cb.rotation.x, cb.rotation.y, cb.rotation.z) : BABYLON.Quaternion.Identity());
                        var scale = cb.scaling ? cb.scaling.clone() : new BABYLON.Vector3(1, 1, 1);
                        // 有效性检查：rot 不能是全零四元数
                        if (rot.x === 0 && rot.y === 0 && rot.z === 0 && rot.w === 0) {
                            rot = BABYLON.Quaternion.Identity();
                        }
                        var localMat = BABYLON.Matrix.Compose(scale, rot, pos);
                        worldMat = worldMat.multiply(localMat);
                    }
                    // v2.1.2：暂时不乘以 mesh 世界矩阵，先验证纯骨骼链是否有效
                    // （mesh 乘法可能导致矩阵奇异，后续再单独处理）
                    // 分解验证：旋转部分必须是有限的
                    var sc = new BABYLON.Vector3();
                    var rt = new BABYLON.Quaternion();
                    var tr = new BABYLON.Vector3();
                    var decomposed = worldMat.decompose(sc, rt, tr);
                    if (!decomposed) return { matrix: null, error: 'decomposeFailed' };
                    if (!isFinite(rt.x) || !isFinite(rt.y) || !isFinite(rt.z) || !isFinite(rt.w)) {
                        return { matrix: null, error: 'rotNaN' };
                    }
                    var qlen = Math.sqrt(rt.x*rt.x + rt.y*rt.y + rt.z*rt.z + rt.w*rt.w);
                    if (qlen < 0.01 || qlen > 100) {
                        return { matrix: null, error: 'qlen=' + qlen.toFixed(3) };
                    }
                    // 归一化四元数
                    if (qlen > 1e-6) {
                        rt.x /= qlen; rt.y /= qlen; rt.z /= qlen; rt.w /= qlen;
                    }
                    return { matrix: worldMat, error: null, rot: rt, trans: tr };
                } catch (e) {
                    return { matrix: null, error: 'exception:' + (e.message || String(e)) };
                }
            }

            // 手动从骨骼父级链累加计算世界位置
            // MikuPlay 的 MmdModel 禁用了 Babylon skeleton 的自动世界矩阵更新，
            // 导致 getAbsolutePosition() 返回 (0,0,0)。
            // 尝试多种方式，选择最合理的结果。
            function getBoneWorldPositionManual(bone, mesh) {
                if (!bone) return null;
                var candidates = [];

                // 注意：不能直接用 bone.position 作为世界位置！
                // bone.position 是骨骼的局部位置（相对于父级），不随头部/身体旋转改变。
                // 如果直接用它，转头时眼球位置不变，导致方向计算错误。
                // 必须用父级链累加或 getFinalMatrix() 来计算包含父级旋转的世界位置。

                // 方式A：父级链累加局部变换（标准方式，包含父级旋转）
                try {
                    var chain = [];
                    var b = bone;
                    var guard = 0;
                    while (b && guard < 100) {
                        chain.unshift(b);
                        b = (typeof b.getParent === 'function') ? b.getParent() : b.parent;
                        guard++;
                    }
                    if (chain.length) {
                        var worldMat = BABYLON.Matrix.Identity();
                        for (var i = 0; i < chain.length; i++) {
                            var cb = chain[i];
                            var pos = cb.position ? cb.position.clone() : BABYLON.Vector3.Zero();
                            var rot = cb.rotationQuaternion ? cb.rotationQuaternion.clone() :
                                      (cb.rotation ? BABYLON.Quaternion.FromEulerAngles(cb.rotation.x, cb.rotation.y, cb.rotation.z) : BABYLON.Quaternion.Identity());
                            var scale = cb.scaling ? cb.scaling.clone() : new BABYLON.Vector3(1, 1, 1);
                            var localMat = BABYLON.Matrix.Compose(scale, rot, pos);
                            worldMat = worldMat.multiply(localMat);
                        }
                        var localPos = worldMat.getTranslation();
                        if (localPos && localPos.y > 5 && localPos.y < 40 && Math.abs(localPos.x) < 15 && Math.abs(localPos.z) < 15) {
                            candidates.push({ pos: localPos.clone(), score: Math.abs(localPos.x) + Math.abs(localPos.z) + 0.1 });
                        }
                    }
                } catch (e) { }

                // 方式B：bone.getFinalMatrix()（先尝试 computeAbsoluteTransforms）
                try {
                    var skel = bone.getSkeleton ? bone.getSkeleton() : null;
                    if (skel && skel.computeAbsoluteTransforms) skel.computeAbsoluteTransforms();
                    var fm = bone.getFinalMatrix ? bone.getFinalMatrix() : null;
                    if (fm) {
                        var fpos = fm.getTranslation();
                        if (fpos && fpos.y > 5 && fpos.y < 40 && Math.abs(fpos.x) < 15 && Math.abs(fpos.z) < 15) {
                            candidates.push({ pos: fpos.clone(), score: Math.abs(fpos.x) + Math.abs(fpos.z) + 0.2 });
                        }
                    }
                } catch (e) { }

                if (!candidates.length) return null;

                // 选择 X/Z 偏离中心最小的结果（眼球通常在模型中心附近）
                candidates.sort(function (a, b) { return a.score - b.score; });
                var bestLocal = candidates[0].pos;

                // 转换到世界空间（乘以 mesh 的世界矩阵）
                if (mesh && mesh.getWorldMatrix) {
                    try {
                        if (typeof mesh.computeWorldMatrix === 'function') {
                            mesh.computeWorldMatrix(true);
                        }
                        var meshWm = mesh.getWorldMatrix();
                        if (meshWm) {
                            var meshTrans = meshWm.getTranslation();
                            // 只有当 mesh 有明显位移时才转换，否则直接用局部位置
                            if (Math.abs(meshTrans.x) > 0.01 || Math.abs(meshTrans.y) > 0.01 || Math.abs(meshTrans.z) > 0.01) {
                                var worldPos = BABYLON.Vector3.TransformCoordinates(bestLocal, meshWm);
                                if (worldPos && worldPos.y > 5 && worldPos.y < 40) {
                                    return worldPos;
                                }
                            }
                        }
                    } catch (e) { }
                }

                return bestLocal;
            }

            // 计算骨骼父级的世界旋转四元数（手动从根骨骼链累加）
            // 眼球骨骼的旋转是相对于父级骨骼的，需要把世界空间方向转换到父级局部空间
            function getParentBoneWorldQuaternion(bone) {
                if (!bone) return null;
                try {
                    var parent = (typeof bone.getParent === 'function') ? bone.getParent() : bone.parent;
                    if (!parent) return BABYLON.Quaternion.Identity();

                    // 收集从根到父级的链
                    var chain = [];
                    var b = parent;
                    var guard = 0;
                    while (b && guard < 100) {
                        chain.unshift(b);
                        b = (typeof b.getParent === 'function') ? b.getParent() : b.parent;
                        guard++;
                    }
                    if (!chain.length) return BABYLON.Quaternion.Identity();

                    // 累加局部旋转四元数（从根开始）
                    var worldRot = BABYLON.Quaternion.Identity();
                    for (var i = 0; i < chain.length; i++) {
                        var cb = chain[i];
                        var localRot = null;
                        if (cb.rotationQuaternion) {
                            localRot = cb.rotationQuaternion;
                        } else if (cb.rotation) {
                            localRot = BABYLON.Quaternion.FromEulerAngles(cb.rotation.x, cb.rotation.y, cb.rotation.z);
                        } else {
                            localRot = BABYLON.Quaternion.Identity();
                        }
                        // 世界旋转 = 父级世界旋转 × 局部旋转
                        BABYLON.Quaternion.MultiplyToRef(worldRot, localRot, worldRot);
                    }
                    return worldRot;
                } catch (e) {
                    return null;
                }
            }

            // 通过 IMmdRuntimeBone 获取父级骨骼的世界旋转四元数（最可靠，包含MMD动画更新）
            // v1.7.9：不依赖 runtimeBone.parent 属性（可能不存在），
            // 改为从 Babylon Bone 向上遍历 parent，按骨骼名在 runtimeBones 数组中匹配
            function getParentRuntimeBoneWorldQuaternion(runtimeBone, babylonBone, mmdModels) {
                // 收集所有 runtimeBones
                var allRtBones = [];
                if (mmdModels) {
                    for (var mi = 0; mi < mmdModels.length; mi++) {
                        if (mmdModels[mi] && mmdModels[mi].runtimeBones) {
                            for (var bi = 0; bi < mmdModels[mi].runtimeBones.length; bi++) {
                                allRtBones.push(mmdModels[mi].runtimeBones[bi]);
                            }
                        }
                    }
                }
                // 如果 runtimeBone 本身有 runtimeBones 引用，也加进去
                if (runtimeBone && runtimeBone.runtimeBones) {
                    allRtBones = allRtBones.concat(runtimeBone.runtimeBones);
                }

                // 方式1：通过 runtimeBone 的 parent/parentIndex 直接查找
                if (runtimeBone) {
                    try {
                        var parentRt = runtimeBone.parent || null;
                        if (typeof runtimeBone.getParent === 'function') parentRt = runtimeBone.getParent();
                        if (!parentRt && runtimeBone.parentIndex !== undefined && runtimeBone.parentIndex >= 0) {
                            for (var ai = 0; ai < allRtBones.length; ai++) {
                                if (allRtBones[ai] && allRtBones[ai].index === runtimeBone.parentIndex) {
                                    parentRt = allRtBones[ai];
                                    break;
                                }
                            }
                        }
                        if (parentRt && typeof parentRt.getWorldMatrixToRef === 'function') {
                            var tmpMat = new BABYLON.Matrix();
                            parentRt.getWorldMatrixToRef(tmpMat);
                            var sc = new BABYLON.Vector3();
                            var rt = new BABYLON.Quaternion();
                            var tr = new BABYLON.Vector3();
                            tmpMat.decompose(sc, rt, tr);
                            return rt;
                        }
                    } catch (e) { }
                }

                // 方式2：从 Babylon Bone 向上遍历 parent，按名字在 runtimeBones 中匹配
                if (babylonBone && allRtBones.length) {
                    try {
                        var parent = (typeof babylonBone.getParent === 'function') ? babylonBone.getParent() : babylonBone.parent;
                        var guard = 0;
                        while (parent && guard < 50) {
                            var pName = parent.name;
                            if (pName) {
                                for (var ri = 0; ri < allRtBones.length; ri++) {
                                    var rb = allRtBones[ri];
                                    if (rb && rb.name === pName && typeof rb.getWorldMatrixToRef === 'function') {
                                        var tmpMat2 = new BABYLON.Matrix();
                                        rb.getWorldMatrixToRef(tmpMat2);
                                        var sc2 = new BABYLON.Vector3();
                                        var rt2 = new BABYLON.Quaternion();
                                        var tr2 = new BABYLON.Vector3();
                                        tmpMat2.decompose(sc2, rt2, tr2);
                                        return rt2;
                                    }
                                }
                            }
                            parent = (typeof parent.getParent === 'function') ? parent.getParent() : parent.parent;
                            guard++;
                        }
                    } catch (e) { }
                }

                return null;
            }

            // ===== 核心跟随逻辑（四元数版本）=====

            // 从相机世界矩阵提取最终渲染位置（比 camera.position 更可靠）
            // MmdCamera 的 position 由 target+rotation+distance 计算，动画更新后可能未同步
            // 世界矩阵是渲染时实际使用的，一定是最新的
            function getCameraWorldPosition(cam) {
                try {
                    var wm = cam.getWorldMatrix();
                    if (wm) {
                        var pos = new BABYLON.Vector3();
                        wm.getTranslationToRef(pos);
                        if (pos && (pos.x !== 0 || pos.y !== 0 || pos.z !== 0)) {
                            return pos;
                        }
                    }
                } catch (e) { }
                // 回退到 camera.position
                return cam.position ? cam.position.clone() : new BABYLON.Vector3();
            }

            function onAfterAnimations() {
                if (!settings.enabled || !scene) return;
                var cam = scene.activeCamera;
                if (!cam || !cam.position) {
                    if (debugEl && settings.showDebug) debugEl.textContent = '调试: activeCamera 为空';
                    return;
                }

                // 使用相机世界矩阵位置（最可靠）
                var rawCamPos = getCameraWorldPosition(cam);

                // 相机位置 EMA 平滑：过滤镜头动画关键帧切换时的位置跳变
                // 这是"导入镜头后偶尔偏转"的主要原因——相机动画关键帧偶尔有突变
                var camSmooth = clamp(settings.angleSmooth, 0.01, 1.0);
                if (!smoothCamPos) {
                    smoothCamPos = rawCamPos.clone();
                } else {
                    smoothCamPos.x += (rawCamPos.x - smoothCamPos.x) * camSmooth;
                    smoothCamPos.y += (rawCamPos.y - smoothCamPos.y) * camSmooth;
                    smoothCamPos.z += (rawCamPos.z - smoothCamPos.z) * camSmooth;
                }
                var camPos = smoothCamPos;

                var modelIds = [];
                if (settings.selectedModelId === '__all__') {
                    var models = listModels();
                    for (var i = 0; i < models.length; i++) {
                        if (models[i] && models[i].id) modelIds.push(String(models[i].id));
                    }
                } else {
                    modelIds.push(settings.selectedModelId);
                }
                if (!modelIds.length) return;

                var targetYaw = 0, targetPitch = 0;
                var hasRef = false;
                var refBone = null;
                var diagMsg = '';
                var lastEyePos = null;
                var usedFallbackGlobal = false;
                var posMethodGlobal = '';
                var lastDist = null;
                var lastVecLen = null;
                var lastFollowFactor = null;
                var lastTargetYaw = 0;
                var lastTargetPitch = 0;
                var lastParentRotInfo = '';

                for (var mi = 0; mi < modelIds.length; mi++) {
                    var entry = getEyeBones(modelIds[mi]);
                    if (!entry) { diagMsg = '模型' + mi + '无骨骼缓存'; continue; }
                    refBone = entry.left || entry.right;
                    if (!refBone) { diagMsg = '模型' + mi + '眼球骨骼为null'; continue; }

                    // 记录诊断信息：mmdModels数量、headRuntime/headBone状态、缓存状态、BoneManager状态、探测结果
                    var mmdCount = entry.mmdModels ? entry.mmdModels.length : 0;
                    var hasCache = cachedHeadWorldRot[modelIds[mi]] ? 'Y' : 'N';
                    var bmState = findBoneManager() ? 'Y' : 'N';
                    var probe = entry.probeInfo || {};
                    lastModelDebugInfo = 'bm=' + bmState +
                        ' mmd=' + mmdCount +
                        ' hRT=' + (entry.headRuntime ? 'Y' : 'N') +
                        ' hB=' + (entry.headBone ? 'Y' : 'N') +
                        ' cache=' + hasCache +
                        ' fRt=' + (probe.foundRuntime || 'none') +
                        ' fMmd=' + (probe.foundMmd || 'none') +
                        ' fBone=' + (probe.foundRt || 'none');

                    var eyePos = null;
                    var usedFallback = false;
                    var posMethod = '';

                    // 确定对应的 runtimeBone（IMmdRuntimeBone，用于获取世界位置）
                    var refRuntimeBone = entry.leftRuntime || entry.rightRuntime;

                    // 方式1（最优先）：用 IMmdRuntimeBone.getWorldMatrixToRef 获取世界位置
                    // 这是 MikuPlay 官方 BoneManager 使用的方式，在 MMD 运行时中最可靠
                    if (refRuntimeBone) {
                        eyePos = getRuntimeBoneWorldPosition(refRuntimeBone);
                        if (eyePos) posMethod = 'runtime';
                    }

                    // 方式2：标准 Babylon Bone.getAbsolutePosition()（需要先 computeAbsoluteTransforms）
                    if (!eyePos) {
                        try {
                            if (entry.skeleton && typeof entry.skeleton.computeAbsoluteTransforms === 'function') {
                                entry.skeleton.computeAbsoluteTransforms();
                            }
                        } catch (e) { }
                        try {
                            eyePos = refBone.getAbsolutePosition();
                            if (!eyePos || (eyePos.x === 0 && eyePos.y === 0 && eyePos.z === 0)) {
                                eyePos = null;
                            } else {
                                posMethod = 'absPos';
                            }
                        } catch (e) { eyePos = null; }
                    }

                    // 方式3（关键）：手动从骨骼父级链累加计算世界位置
                    // MikuPlay 的 MmdModel 禁用了 Babylon skeleton 自动世界矩阵更新，
                    // 导致 getAbsolutePosition() 永远返回 (0,0,0)。
                    // 但骨骼局部 rotationQuaternion 是最新的，手动累加可得到准确位置。
                    if (!eyePos) {
                        try {
                            var modelInfo = getModelInfo(modelIds[mi]);
                            var meshForCalc = modelInfo ? modelInfo.mesh : null;
                            eyePos = getBoneWorldPositionManual(refBone, meshForCalc);
                            if (eyePos) posMethod = 'manual';
                        } catch (e4) { eyePos = null; }
                    }

                    // 备用方案1：找头部骨骼（"頭"）的 runtimeBone 世界位置 + 偏移
                    if (!eyePos) {
                        try {
                            if (entry.mmdModels && entry.mmdModels.length) {
                                for (var mi2 = 0; mi2 < entry.mmdModels.length; mi2++) {
                                    var rbones = entry.mmdModels[mi2].runtimeBones || [];
                                    for (var bi2 = 0; bi2 < rbones.length; bi2++) {
                                        var rbn = rbones[bi2];
                                        if (rbn && rbn.name && (rbn.name === '頭' || rbn.name === 'Head' || rbn.name === 'head')) {
                                            var headPos2 = getRuntimeBoneWorldPosition(rbn);
                                            if (headPos2) {
                                                eyePos = new BABYLON.Vector3(headPos2.x, headPos2.y + 1.5, headPos2.z);
                                                usedFallback = true;
                                                posMethod = 'headRuntime';
                                                break;
                                            }
                                        }
                                    }
                                    if (eyePos) break;
                                }
                            }
                        } catch (e3) { }
                    }

                    // 备用方案2：用模型根节点世界位置 + 固定头部高度
                    if (!eyePos) {
                        try {
                            var info = getModelInfo(modelIds[mi]);
                            if (info && info.mesh && typeof info.mesh.getAbsolutePosition === 'function') {
                                var modelPos = info.mesh.getAbsolutePosition();
                                if (modelPos) {
                                    eyePos = new BABYLON.Vector3(modelPos.x, modelPos.y + 12, modelPos.z);
                                    usedFallback = true;
                                    posMethod = 'modelRoot';
                                }
                            }
                        } catch (e2) { eyePos = null; }
                    }

                    if (!eyePos) { diagMsg = '骨骼' + refBone.name + '获取位置失败'; continue; }

                    try {
                        // ===== 精度防护：提前计算距离，极近距离跳过归一化除法 =====
                        var rawDir = camPos.subtract(eyePos);
                        var distSq = rawDir.lengthSquared();
                        var dist = Math.sqrt(distSq);
                        lastDist = dist;

                        // 距离极近时，直接复用上次目标角度，跳过 normalize()/atan2 等除法运算
                        // 避免浮点精度在小向量归一化时爆炸导致抖动
                        var minD = settings.minDistance || 2.5;
                        if (dist < minD * 0.5) {
                            // 距离过近：完全冻结角度，不更新目标
                            targetYaw = lastTargetYaw;
                            targetPitch = lastTargetPitch;
                            hasRef = true;
                            lastEyePos = eyePos;
                            usedFallbackGlobal = usedFallback;
                            posMethodGlobal = posMethod;
                            lastVecLen = dist;
                            if (usedFallback) diagMsg = '备用位置(' + posMethod + ')';
                            break;
                        }

                        // 向量最小长度钳位：防止分母趋近0
                        var safeLen = Math.max(dist, 1e-4);
                        lastVecLen = safeLen;

                        // 归一化（使用钳位后的安全长度，避免除零精度问题）
                        var dir = rawDir.scale(1.0 / safeLen);

                        // ===== v2.0.3：优先用 onAfterRender 缓存的头部世界旋转 =====
                        // 原理：onAfterRender 时骨骼矩阵已用于渲染，getFinalMatrix() 有效
                        // 缓存后下一帧 onBeforeRender 追踪时使用，有一帧延迟但比获取不到好
                        var parentWorldRot = null;
                        var parentMethod = '';
                        var cachedQ = cachedHeadWorldRot[modelIds[mi]];
                        if (cachedQ) {
                            // 有效性检查：必须是有限的单位四元数
                            var ql = Math.sqrt(cachedQ.x*cachedQ.x + cachedQ.y*cachedQ.y + cachedQ.z*cachedQ.z + cachedQ.w*cachedQ.w);
                            if (isFinite(cachedQ.x) && isFinite(cachedQ.y) && isFinite(cachedQ.z) && isFinite(cachedQ.w) &&
                                ql > 0.5 && ql < 2.0) {
                                parentWorldRot = cachedQ;
                                parentMethod = 'cached';
                            } else {
                                // 无效缓存，清除
                                delete cachedHeadWorldRot[modelIds[mi]];
                            }
                        }

                        // 方式0（v2.1.0最优先）：头部骨骼的手动父级链累加世界矩阵
                        // 已验证：getBoneWorldPositionManual 的 getTranslation() 有效（eye=...[manual]）
                        // 因此同一个矩阵的旋转部分也一定有效！完全不依赖 MmdRuntime。
                        // 包含整条父级链（头部→颈部→上半身→下半身→根节点），身体旋转自动生效。
                        var manualHeadError = '';
                        if (!parentWorldRot && entry.headBone) {
                            try {
                                var headResult = getBoneWorldMatrixManual(entry.headBone, entry.mesh);
                                if (headResult && headResult.matrix && headResult.rot) {
                                    parentWorldRot = headResult.rot;
                                    parentMethod = 'manualHead';
                                } else if (headResult && headResult.error) {
                                    manualHeadError = headResult.error;
                                }
                            } catch (eManual) {
                                manualHeadError = 'exc:' + (eManual.message || String(eManual));
                            }
                        }

                        // 方式1：头部 runtimeBone 的世界矩阵
                        if (!parentWorldRot) try {
                            // 方式1（最优先）：头部 runtimeBone 的世界矩阵
                            if (entry.headRuntime && typeof entry.headRuntime.getWorldMatrixToRef === 'function') {
                                var headWm = new BABYLON.Matrix();
                                entry.headRuntime.getWorldMatrixToRef(headWm);
                                var hScale = new BABYLON.Vector3();
                                var hWorldQ = new BABYLON.Quaternion();
                                var hTrans = new BABYLON.Vector3();
                                headWm.decompose(hScale, hWorldQ, hTrans);
                                if (isFinite(hWorldQ.x) && isFinite(hWorldQ.y) && isFinite(hWorldQ.z) && isFinite(hWorldQ.w)) {
                                    parentWorldRot = hWorldQ;
                                    parentMethod = 'headRuntime';
                                }
                            }
                        } catch (eHead) { }

                        // 方式2：头部 Babylon bone 的 getFinalMatrix
                        if (!parentWorldRot && entry.headBone) {
                            try {
                                var skel = entry.headBone.getSkeleton ? entry.headBone.getSkeleton() : null;
                                if (skel && skel.computeAbsoluteTransforms) skel.computeAbsoluteTransforms();
                                var fm = entry.headBone.getFinalMatrix ? entry.headBone.getFinalMatrix() : null;
                                if (fm) {
                                    var fScale = new BABYLON.Vector3();
                                    var fWorldQ = new BABYLON.Quaternion();
                                    var fTrans = new BABYLON.Vector3();
                                    fm.decompose(fScale, fWorldQ, fTrans);
                                    if (isFinite(fWorldQ.x) && isFinite(fWorldQ.w)) {
                                        parentWorldRot = fWorldQ;
                                        parentMethod = 'headBone';
                                    }
                                }
                            } catch (eHead2) { }
                        }

                        // 方式3（回退）：眼球世界矩阵反推父级旋转
                        if (!parentWorldRot) {
                            try {
                                var eyeRtForParent = entry.leftRuntime || entry.rightRuntime;
                                if (eyeRtForParent && typeof eyeRtForParent.getWorldMatrixToRef === 'function') {
                                    var eyeWm = new BABYLON.Matrix();
                                    eyeRtForParent.getWorldMatrixToRef(eyeWm);
                                    var eyeScale = new BABYLON.Vector3();
                                    var eyeWorldQ = new BABYLON.Quaternion();
                                    var eyeTrans = new BABYLON.Vector3();
                                    eyeWm.decompose(eyeScale, eyeWorldQ, eyeTrans);
                                    var eyeLocalQ = null;
                                    if (refBone && refBone.rotationQuaternion) {
                                        eyeLocalQ = refBone.rotationQuaternion.clone();
                                    } else if (refBone && refBone.rotation) {
                                        eyeLocalQ = BABYLON.Quaternion.FromEulerAngles(refBone.rotation.x, refBone.rotation.y, refBone.rotation.z);
                                    }
                                    if (eyeLocalQ) {
                                        var invEyeLocal = BABYLON.Quaternion.Inverse(eyeLocalQ);
                                        var inferredQ = BABYLON.Quaternion.Multiply(eyeWorldQ, invEyeLocal);
                                        // NaN检查
                                        if (isFinite(inferredQ.x) && isFinite(inferredQ.y) && isFinite(inferredQ.z) && isFinite(inferredQ.w) && Math.abs(inferredQ.w) > 1e-6) {
                                            parentWorldRot = inferredQ;
                                            parentMethod = 'infer';
                                        }
                                    }
                                }
                            } catch (eParent) { }
                        }

                        // 方式4（最终回退）：手动累加 Babylon Bone 父级链
                        if (!parentWorldRot) {
                            var manualQ = getParentBoneWorldQuaternion(refBone);
                            if (manualQ && isFinite(manualQ.x) && isFinite(manualQ.w) && Math.abs(manualQ.w) > 1e-6) {
                                parentWorldRot = manualQ;
                                parentMethod = 'manual';
                            }
                        }

                        // 记录头部骨骼查找状态（用于调试）
                        var headInfo = 'head=' + (entry.headRuntime ? 'RT' : (entry.headBone ? 'B' : 'no'));

                        try {
                            if (parentWorldRot && isFinite(parentWorldRot.x) && isFinite(parentWorldRot.y) &&
                                isFinite(parentWorldRot.z) && isFinite(parentWorldRot.w)) {
                                // v2.1.5：全部用手动实现，不依赖Babylon.js API（兼容MikuPlay旧版本）
                                var invParentRot = quaternionInverse(parentWorldRot);
                                var invParentMat = quaternionToMatrix(invParentRot);
                                var localDir = BABYLON.Vector3.TransformNormal(dir, invParentMat);
                                // 转换后NaN检查
                                if (isFinite(localDir.x) && isFinite(localDir.y) && isFinite(localDir.z) && localDir.lengthSquared() > 1e-8) {
                                    dir = localDir.normalize();
                                }
                                lastParentRotInfo = 'pRot[' + (parentMethod || '?') + ']=' + parentWorldRot.x.toFixed(2) + ',' + parentWorldRot.y.toFixed(2) + ',' + parentWorldRot.z.toFixed(2) + ',' + parentWorldRot.w.toFixed(2) + ' ' + headInfo;
                            } else {
                                // 最终兜底：父级旋转全部获取失败时，直接用世界空间方向
                                // 至少眼球会跟随相机，虽然在头部旋转时可能不准确
                                var pRotValid = parentWorldRot ? ('invalid:' + parentWorldRot.x + ',' + parentWorldRot.y + ',' + parentWorldRot.z + ',' + parentWorldRot.w) : 'null';
                                lastParentRotInfo = 'pRot=none(worldDir) manualErr=' + (manualHeadError || 'none') + ' pRot=' + pRotValid + ' ' + headInfo;
                            }
                        } catch (eConv) {
                            lastParentRotInfo = 'pRot=err(worldDir) manualErr=' + (manualHeadError || 'none') + ' convErr=' + (eConv.message || String(eConv)) + ' ' + headInfo;
                        }

                        // ===== 约束6：NaN有效性检查 =====
                        var yaw = Math.atan2(dir.x, -dir.z);
                        var horizDist = Math.sqrt(dir.x * dir.x + dir.z * dir.z);
                        var pitch = Math.atan2(dir.y, horizDist);
                        if (!isFinite(yaw) || !isFinite(pitch)) {
                            diagMsg = 'yaw/pitch为NaN';
                            continue;
                        }

                        // ===== 约束6：后方检查（模型默认面向-Z，相机在+Z方向为后方）=====
                        var isBehind = settings.behindIgnore && dir.z > 0.3;

                        // ===== 约束5：死区（微小角度归零，防止抖动）=====
                        var dz = settings.deadZone || 0.01;
                        if (Math.abs(yaw) < dz) yaw = 0;
                        if (Math.abs(pitch) < dz) pitch = 0;

                        // ===== 约束4：椭圆/软限位（上下独立最大值）=====
                        var maxYawRad = deg2rad(settings.maxYaw);
                        var maxPitchRad = pitch > 0 ? deg2rad(settings.maxPitchUp) : deg2rad(settings.maxPitchDown);
                        if (settings.ellipseLimit && maxYawRad > 0 && maxPitchRad > 0) {
                            var ellipseVal = (yaw * yaw) / (maxYawRad * maxYawRad) +
                                             (pitch * pitch) / (maxPitchRad * maxPitchRad);
                            if (ellipseVal > 1) {
                                var eScale = 1.0 / Math.sqrt(ellipseVal);
                                yaw *= eScale;
                                pitch *= eScale;
                            }
                        } else {
                            yaw = clamp(yaw, -maxYawRad, maxYawRad);
                            pitch = clamp(pitch, -maxPitchRad, maxPitchRad);
                        }

                        // ===== 约束6：距离衰减 + 最大距离 + 后方停止 =====
                        var followFactor = 1.0;
                        if (dist < minD * 2.0) {
                            if (dist <= minD) {
                                followFactor = 0.0;
                            } else {
                                followFactor = (dist - minD) / minD;
                            }
                        }
                        if (settings.maxDistance && dist > settings.maxDistance) followFactor = 0.0;
                        if (isBehind) followFactor = 0.0;
                        lastFollowFactor = followFactor;

                        yaw *= settings.intensity * followFactor;
                        pitch *= settings.intensity * followFactor;

                        // 保存目标角度（供近距离冻结时复用）
                        lastTargetYaw = yaw;
                        lastTargetPitch = pitch;

                        targetYaw = yaw;
                        targetPitch = pitch;
                        hasRef = true;
                        lastEyePos = eyePos;
                        usedFallbackGlobal = usedFallback;
                        posMethodGlobal = posMethod;
                        if (usedFallback) diagMsg = '备用位置(' + posMethod + ')';
                        if (isBehind) diagMsg = (diagMsg ? diagMsg + ' ' : '') + '后方';
                        break;
                    } catch (e) { diagMsg = '方向计算异常:' + e.message; continue; }
                }

                if (!hasRef) {
                    if (debugEl && settings.showDebug) {
                        debugEl.textContent = '调试: 未找到有效眼球 (' + diagMsg + ')';
                    }
                    return;
                }

                // ===== 约束10：异常回滚（目标角度NaN时回退到上一帧有效值，连续失败回中）=====
                if (!isFinite(targetYaw) || !isFinite(targetPitch)) {
                    consecutiveFails++;
                    if (settings.failRecovery === 'center' || consecutiveFails > 30) {
                        targetYaw = 0; targetPitch = 0;
                    } else {
                        targetYaw = lastValidYaw;
                        targetPitch = lastValidPitch;
                    }
                } else {
                    consecutiveFails = 0;
                    lastValidYaw = targetYaw;
                    lastValidPitch = targetPitch;
                }

                // ===== 约束5：角速度限制（单帧最大变化量）=====
                var maxStep = settings.maxAngleStep || 0.12;
                var limitedYaw = clampAngleStep(targetYaw, curYaw, maxStep);
                var limitedPitch = clampAngleStep(targetPitch, curPitch, maxStep);

                // ===== 约束5：角加速度限制（限制角速度的变化量，使运动更平滑自然）=====
                var targetYawVel = angleDiff(limitedYaw, curYaw);
                var targetPitchVel = limitedPitch - curPitch;
                var maxAccel = settings.maxAngleAccel || 0.06;
                var yawVelDiff = targetYawVel - curYawVel;
                var pitchVelDiff = targetPitchVel - curPitchVel;
                if (yawVelDiff > maxAccel) yawVelDiff = maxAccel;
                if (yawVelDiff < -maxAccel) yawVelDiff = -maxAccel;
                if (pitchVelDiff > maxAccel) pitchVelDiff = maxAccel;
                if (pitchVelDiff < -maxAccel) pitchVelDiff = -maxAccel;
                curYawVel += yawVelDiff;
                curPitchVel += pitchVelDiff;
                var accelLimitedYaw = curYaw + curYawVel;
                var accelLimitedPitch = curPitch + curPitchVel;

                // ===== 约束5：角度域EMA平滑 =====
                var angSmooth = clamp(settings.angleSmooth, 0.01, 1.0);
                curYaw += angleDiff(accelLimitedYaw, curYaw) * angSmooth;
                curPitch += (accelLimitedPitch - curPitch) * angSmooth;

                if (debugEl && settings.showDebug) {
                    var eyeStr = lastEyePos ? (lastEyePos.x.toFixed(1) + ',' + lastEyePos.y.toFixed(1) + ',' + lastEyePos.z.toFixed(1)) : '?';
                    debugEl.textContent = '调试: yaw=' + curYaw.toFixed(3) +
                        ' pitch=' + curPitch.toFixed(3) +
                        ' dist=' + (typeof lastDist === 'number' ? lastDist.toFixed(2) : '?') +
                        ' ff=' + (typeof lastFollowFactor === 'number' ? lastFollowFactor.toFixed(2) : '?') +
                        ' fail=' + consecutiveFails +
                        ' ' + lastModelDebugInfo +
                        ' eye=' + eyeStr + '[' + (posMethodGlobal || '?') + ']' +
                        ' cam=' + (camPos ? (camPos.x.toFixed(1) + ',' + camPos.y.toFixed(1) + ',' + camPos.z.toFixed(1)) : '?') +
                        ' 微调=' + settings.manualYaw.toFixed(0) + '/' + settings.manualPitch.toFixed(0) +
                        ' 骨=' + (refBone ? refBone.name : '?') +
                        ' ' + lastParentRotInfo +
                        (diagMsg ? ' [' + diagMsg + ']' : '');
                }

                // ===== 手动微调 + 约束4：最终椭圆限位（二次，上下独立）=====
                var rawOffsetYaw = curYaw * (settings.invertYaw ? -1 : 1) + deg2rad(settings.manualYaw);
                var rawOffsetPitch = curPitch * (settings.invertPitch ? -1 : 1) + deg2rad(settings.manualPitch);
                var fMaxYaw = deg2rad(settings.maxYaw);
                var fMaxPitch = rawOffsetPitch > 0 ? deg2rad(settings.maxPitchUp) : deg2rad(settings.maxPitchDown);
                if (settings.ellipseLimit && fMaxYaw > 0 && fMaxPitch > 0) {
                    var fe = (rawOffsetYaw * rawOffsetYaw) / (fMaxYaw * fMaxYaw) +
                             (rawOffsetPitch * rawOffsetPitch) / (fMaxPitch * fMaxPitch);
                    if (fe > 1) {
                        var fs = 1.0 / Math.sqrt(fe);
                        rawOffsetYaw *= fs;
                        rawOffsetPitch *= fs;
                    }
                } else {
                    rawOffsetYaw = clamp(rawOffsetYaw, -fMaxYaw, fMaxYaw);
                    rawOffsetPitch = clamp(rawOffsetPitch, -deg2rad(settings.maxPitchDown), deg2rad(settings.maxPitchUp));
                }

                // ===== 约束7：双眼会聚限制（看近物时双眼内聚，限制最大会聚角）=====
                var convRad = deg2rad(clamp(settings.convergence, -settings.maxConvergence, settings.maxConvergence));

                for (var mi2 = 0; mi2 < modelIds.length; mi2++) {
                    var entry2 = getEyeBones(modelIds[mi2]);
                    if (!entry2) continue;
                    // 左眼：会聚时向内转（yaw减小），右眼：会聚时向内转（yaw增大）
                    applyEyeOffset(entry2.left, entry2.leftOrigQ, rawOffsetYaw - convRad, rawOffsetPitch);
                    applyEyeOffset(entry2.right, entry2.rightOrigQ, rawOffsetYaw + convRad, rawOffsetPitch);
                }
            }

            function applyEyeOffset(bone, origQ, yaw, pitch) {
                if (!bone) return;
                try {
                    // 约束6：NaN检查，无效值直接跳过
                    if (!isFinite(yaw) || !isFinite(pitch)) return;

                    var finalYaw = yaw;
                    var finalPitch = pitch;
                    if (settings.swapAxis) {
                        var tmp = finalYaw;
                        finalYaw = finalPitch;
                        finalPitch = tmp;
                    }

                    // 约束4：最终钳位（swapAxis后再次确保不超限）
                    finalYaw = clamp(finalYaw, -deg2rad(settings.maxYaw), deg2rad(settings.maxYaw));
                    finalPitch = clamp(finalPitch, -deg2rad(settings.maxPitchDown), deg2rad(settings.maxPitchUp));

                    // 约束9：每帧从默认旋转重新计算，不累加
                    // 约束3：roll固定为0（FromEulerAngles的第三个参数为0）
                    // 约束1：只修改rotationQuaternion，不修改position（锁位置）
                    var baseQ = BABYLON.Quaternion.Identity();
                    var offsetQ = BABYLON.Quaternion.FromEulerAngles(finalPitch, finalYaw, 0);
                    var finalQ = offsetQ.multiply(baseQ);

                    // 约束6：最终四元数NaN检查
                    if (!isFinite(finalQ.x) || !isFinite(finalQ.y) || !isFinite(finalQ.z) || !isFinite(finalQ.w)) return;

                    bone.rotationQuaternion = finalQ;
                } catch (e) { }
            }

            // onAfterRender 时缓存头部世界矩阵
            // 原理：渲染完毕后，骨骼的绝对变换已经被计算并用于渲染
            // 此时调用 computeAbsoluteTransforms + getFinalMatrix 能得到有效的世界矩阵
            // （在 onBeforeRender 时 MMD 运行时可能还没更新，getFinalMatrix 无效）
            function cacheHeadWorldRotOnAfterRender() {
                try {
                    for (var mid in eyeCache) {
                        if (!eyeCache.hasOwnProperty(mid)) continue;
                        var entry = eyeCache[mid];
                        if (!entry.headBone) continue;
                        try {
                            var skel = entry.headBone.getSkeleton ? entry.headBone.getSkeleton() : null;
                            if (skel && skel.computeAbsoluteTransforms) skel.computeAbsoluteTransforms();
                            var fm = entry.headBone.getFinalMatrix ? entry.headBone.getFinalMatrix() : null;
                            if (fm) {
                                // 矩阵有效性检查：行列式不能接近0（奇异矩阵）
                                var det = fm.determinant ? fm.determinant() : 1;
                                if (!isFinite(det) || Math.abs(det) < 1e-10) continue;
                                // 矩阵不能是全零或单位矩阵（getFinalMatrix 无效时可能返回这些）
                                var mArr = fm.m ? fm.m : null;
                                if (mArr) {
                                    var isZero = true;
                                    for (var zi = 0; zi < 16; zi++) { if (mArr[zi] !== 0) { isZero = false; break; } }
                                    if (isZero) continue;
                                }
                                var sc = new BABYLON.Vector3();
                                var rt = new BABYLON.Quaternion();
                                var tr = new BABYLON.Vector3();
                                fm.decompose(sc, rt, tr);
                                // 严格的四元数有效性检查
                                if (isFinite(rt.x) && isFinite(rt.y) && isFinite(rt.z) && isFinite(rt.w)) {
                                    var qlen = Math.sqrt(rt.x*rt.x + rt.y*rt.y + rt.z*rt.z + rt.w*rt.w);
                                    if (qlen > 1e-6 && qlen < 10) {
                                        // 归一化
                                        rt.x /= qlen; rt.y /= qlen; rt.z /= qlen; rt.w /= qlen;
                                        // 平移量检查：头部位置应该在合理范围内（不是原点）
                                        if (isFinite(tr.x) && isFinite(tr.y) && isFinite(tr.z) &&
                                            Math.abs(tr.x) < 1000 && Math.abs(tr.y) < 1000 && Math.abs(tr.z) < 1000) {
                                            cachedHeadWorldRot[mid] = rt;
                                        }
                                    }
                                }
                            }
                        } catch (e) { }
                    }
                } catch (e) { }
            }

            function startTracking() {
                if (animObserver || !scene) return;
                // 使用 onBeforeRender（比 onAfterAnimations 更晚），确保在 MMD 运行时更新骨骼和相机动画之后执行
                // 这样拿到的相机位置是最新的，设置的眼球旋转也不会被动作覆盖
                animObserver = scene.onBeforeRenderObservable.add(onAfterAnimations);
                // onAfterRender 时缓存头部世界矩阵（此时骨骼矩阵已用于渲染，是有效的）
                afterRenderObserver = scene.onAfterRenderObservable.add(cacheHeadWorldRotOnAfterRender);
            }

            function stopTracking() {
                if (animObserver && scene) {
                    scene.onBeforeRenderObservable.remove(animObserver);
                    animObserver = null;
                }
                if (afterRenderObserver && scene) {
                    scene.onAfterRenderObservable.remove(afterRenderObserver);
                    afterRenderObserver = null;
                }
                cachedHeadWorldRot = {};
            }

            // 恢复所有眼球骨骼的原始旋转
            function restoreAllEyes() {
                for (var mid in eyeCache) {
                    if (!eyeCache.hasOwnProperty(mid)) continue;
                    var entry = eyeCache[mid];
                    try {
                        if (entry.left && entry.leftOrigQ) {
                            entry.left.rotationQuaternion = entry.leftOrigQ.clone();
                        }
                    } catch (e) { }
                    try {
                        if (entry.right && entry.rightOrigQ) {
                            entry.right.rotationQuaternion = entry.rightOrigQ.clone();
                        }
                    } catch (e) { }
                }
            }

            // 重置眼球位置：清零手动微调、汇聚和平滑变量，恢复原始旋转
            function resetEyePosition() {
                settings.manualYaw = 0;
                settings.manualPitch = 0;
                settings.convergence = 0;
                curYaw = 0;
                curPitch = 0;
                curYawVel = 0;
                curPitchVel = 0;
                lastValidYaw = 0;
                lastValidPitch = 0;
                consecutiveFails = 0;
                smoothCamPos = null;
                restoreAllEyes();
                // 重建 UI 以更新滑块显示
                if (container) {
                    while (container.firstChild) container.removeChild(container.firstChild);
                    buildUI();
                    refreshModelDropdown();
                }
                saveSettings();
                toast('眼球位置已重置');
            }

            // ===== UI 构建 =====
            function createSection(title, expanded) {
                var section = document.createElement('div');
                section.style.cssText = 'background:var(--color-surface);border-radius:var(--radius-md);border:1px solid var(--color-border);overflow:hidden;';

                var header = document.createElement('div');
                header.style.cssText = 'cursor:pointer;padding:10px 14px;display:flex;align-items:center;justify-content:space-between;user-select:none;';
                var titleSpan = document.createElement('span');
                titleSpan.style.cssText = 'font-size:14px;font-weight:600;color:var(--text-primary);';
                titleSpan.textContent = title;
                var arrow = document.createElement('span');
                arrow.textContent = expanded ? '\u25BC' : '\u25B6';
                arrow.style.cssText = 'font-size:10px;color:var(--text-secondary);';
                header.appendChild(titleSpan);
                header.appendChild(arrow);

                var content = document.createElement('div');
                content.style.cssText = 'padding:10px 14px;display:' + (expanded ? 'flex' : 'none') + ';flex-direction:column;gap:10px;';

                header.addEventListener('click', function () {
                    var isExp = content.style.display !== 'none';
                    content.style.display = isExp ? 'none' : 'flex';
                    arrow.textContent = isExp ? '\u25B6' : '\u25BC';
                });

                section.appendChild(header);
                section.appendChild(content);
                return { element: section, content: content };
            }

            function refreshModelDropdown() {
                if (!modelSelectEl) return;
                modelSelectEl.innerHTML = '';
                var allOpt = document.createElement('option');
                allOpt.value = '__all__'; allOpt.textContent = '全部模型';
                modelSelectEl.appendChild(allOpt);

                var models = listModels();
                for (var i = 0; i < models.length; i++) {
                    var opt = document.createElement('option');
                    opt.value = String(models[i].id);
                    opt.textContent = models[i].name || ('模型 ' + i);
                    modelSelectEl.appendChild(opt);
                }
                modelSelectEl.value = settings.selectedModelId;
                refreshBoneDropdowns();
            }

            function refreshBoneDropdowns() {
                if (!leftBoneSelectEl || !rightBoneSelectEl) return;
                var boneNames = listAllBoneNames(settings.selectedModelId);

                function fillSelect(sel, currentVal, placeholder) {
                    sel.innerHTML = '';
                    var autoOpt = document.createElement('option');
                    autoOpt.value = ''; autoOpt.textContent = placeholder;
                    sel.appendChild(autoOpt);
                    for (var i = 0; i < boneNames.length; i++) {
                        var opt = document.createElement('option');
                        opt.value = boneNames[i]; opt.textContent = boneNames[i];
                        sel.appendChild(opt);
                    }
                    sel.value = currentVal || '';
                }

                fillSelect(leftBoneSelectEl, settings.leftBoneName, '自动检测左眼');
                fillSelect(rightBoneSelectEl, settings.rightBoneName, '自动检测右眼');
                updateStatus();
            }

            function updateStatus() {
                if (!statusEl) return;
                if (!settings.enabled) {
                    statusEl.textContent = '状态：已停用';
                    statusEl.style.color = 'var(--text-secondary)';
                    return;
                }

                var modelIds = [];
                if (settings.selectedModelId === '__all__') {
                    var models = listModels();
                    for (var i = 0; i < models.length; i++) {
                        if (models[i] && models[i].id) modelIds.push(String(models[i].id));
                    }
                } else {
                    modelIds.push(settings.selectedModelId);
                }

                var detected = 0, total = 0;
                for (var mi = 0; mi < modelIds.length; mi++) {
                    total++;
                    var entry = getEyeBones(modelIds[mi]);
                    if (entry && (entry.left || entry.right)) detected++;
                }

                if (detected > 0) {
                    statusEl.textContent = '状态：运行中（已识别 ' + detected + '/' + total + ' 个模型的眼球）';
                    statusEl.style.color = '#4caf50';
                } else {
                    statusEl.textContent = '状态：未检测到眼球骨骼，请手动指定';
                    statusEl.style.color = '#ff9800';
                }
            }

            function buildUI() {
                container.innerHTML = '';

                var title = document.createElement('div');
                title.style.cssText = 'font-size:16px;font-weight:bold;color:var(--text-primary);margin-bottom:2px;';
                title.textContent = '目光跟随相机 v1.1';
                container.appendChild(title);

                var subtitle = document.createElement('div');
                subtitle.style.cssText = 'font-size:12px;color:var(--text-secondary);margin-bottom:10px;';
                subtitle.textContent = '四元数驱动 · 动画后执行 · 兼容MMD动作';
                container.appendChild(subtitle);

                statusEl = document.createElement('div');
                statusEl.style.cssText = 'font-size:12px;padding:6px 10px;background:var(--color-surface);border-radius:var(--radius-sm);border:1px solid var(--color-border);margin-bottom:6px;';
                container.appendChild(statusEl);

                debugEl = document.createElement('div');
                debugEl.style.cssText = 'font-size:11px;padding:4px 10px;background:rgba(0,0,0,0.3);border-radius:var(--radius-sm);color:#ffd54f;margin-bottom:10px;font-family:monospace;';
                debugEl.textContent = '调试: 等待数据...';
                container.appendChild(debugEl);

                var baseSec = createSection('基础控制', true);
                container.appendChild(baseSec.element);

                baseSec.content.appendChild(safeToggle('启用目光跟随', settings.enabled, function (v) {
                    settings.enabled = v;
                    if (v) { startTracking(); } else { stopTracking(); restoreAllEyes(); }
                    saveSettings();
                    updateStatus();
                }));

                var modelRow = document.createElement('div');
                modelRow.style.cssText = 'display:flex;align-items:center;gap:8px;';
                var modelLab = document.createElement('span');
                modelLab.style.cssText = 'font-size:13px;color:var(--text-secondary);min-width:60px;flex-shrink:0;';
                modelLab.textContent = '目标模型';
                modelSelectEl = document.createElement('select');
                modelSelectEl.style.cssText = 'flex:1;padding:6px;border:1px solid var(--color-border);border-radius:var(--radius-sm);background:var(--color-surface);color:var(--text-primary);font-size:13px;';
                modelSelectEl.addEventListener('change', function () {
                    settings.selectedModelId = modelSelectEl.value;
                    clearEyeCache();
                    refreshBoneDropdowns();
                    saveSettings();
                });
                modelRow.appendChild(modelLab);
                modelRow.appendChild(modelSelectEl);
                baseSec.content.appendChild(modelRow);

                baseSec.content.appendChild(safeSlider('跟随强度', 0, 1.5, settings.intensity, 0.05, function (v) {
                    settings.intensity = v; saveSettings();
                }));

                baseSec.content.appendChild(safeSlider('平滑速度', 0.02, 0.8, settings.smoothness, 0.02, function (v) {
                    settings.smoothness = v; saveSettings();
                }));

                baseSec.content.appendChild(safeSlider('角度平滑(防抖)', 0.02, 0.8, settings.angleSmooth, 0.02, function (v) {
                    settings.angleSmooth = v; saveSettings();
                }));

                baseSec.content.appendChild(safeSlider('最小跟随距离', 0.5, 8.0, settings.minDistance, 0.1, function (v) {
                    settings.minDistance = v; saveSettings();
                }));

                baseSec.content.appendChild(safeSlider('单帧最大角度', 0.02, 0.5, settings.maxAngleStep, 0.01, function (v) {
                    settings.maxAngleStep = v; saveSettings();
                }));

                baseSec.content.appendChild(safeToggle('显示调试信息', settings.showDebug, function (v) {
                    settings.showDebug = v;
                    if (debugEl) debugEl.style.display = v ? 'block' : 'none';
                    saveSettings();
                }));

                var angleSec = createSection('旋转角度限制（约束4：椭圆/软限位）', false);
                container.appendChild(angleSec.element);

                angleSec.content.appendChild(safeSlider('最大左右角度 (°)', 5, 60, settings.maxYaw, 1, function (v) {
                    settings.maxYaw = v; saveSettings();
                }));

                angleSec.content.appendChild(safeSlider('最大上转角度 (°)', 5, 45, settings.maxPitchUp, 1, function (v) {
                    settings.maxPitchUp = v; saveSettings();
                }));

                angleSec.content.appendChild(safeSlider('最大下转角度 (°)', 5, 60, settings.maxPitchDown, 1, function (v) {
                    settings.maxPitchDown = v; saveSettings();
                }));

                angleSec.content.appendChild(safeToggle('椭圆限位（推荐）', settings.ellipseLimit, function (v) {
                    settings.ellipseLimit = v; saveSettings();
                }));

                var angleNote = document.createElement('div');
                angleNote.style.cssText = 'font-size:11px;color:var(--text-secondary);line-height:1.6;';
                angleNote.textContent = '椭圆限位：同时接近上下左右极限时，按椭圆方程平滑缩放，避免角落区域眼球翻转。上下独立：人眼下转极限通常大于上转。';
                angleSec.content.appendChild(angleNote);

                // ===== 高级约束 =====
                var advSec = createSection('高级约束（防抖/距离/异常处理）', false);
                container.appendChild(advSec.element);

                advSec.content.appendChild(safeSlider('死区（弧度）', 0, 0.1, settings.deadZone, 0.005, function (v) {
                    settings.deadZone = v; saveSettings();
                }));

                advSec.content.appendChild(safeSlider('单帧最大角速度', 0.02, 0.5, settings.maxAngleStep, 0.01, function (v) {
                    settings.maxAngleStep = v; saveSettings();
                }));

                advSec.content.appendChild(safeSlider('单帧最大角加速度', 0.01, 0.2, settings.maxAngleAccel, 0.005, function (v) {
                    settings.maxAngleAccel = v; saveSettings();
                }));

                advSec.content.appendChild(safeSlider('最大跟随距离', 50, 500, settings.maxDistance, 10, function (v) {
                    settings.maxDistance = v; saveSettings();
                }));

                advSec.content.appendChild(safeToggle('相机在后方时停止跟随', settings.behindIgnore, function (v) {
                    settings.behindIgnore = v; saveSettings();
                }));

                advSec.content.appendChild(safeSlider('最大双眼汇聚角 (°)', 0, 30, settings.maxConvergence, 1, function (v) {
                    settings.maxConvergence = v; saveSettings();
                }));

                var advNote = document.createElement('div');
                advNote.style.cssText = 'font-size:11px;color:var(--text-secondary);line-height:1.6;';
                advNote.textContent = '死区：微小角度归零防抖。角加速度：限制眼球转动的加速度，使运动更自然。后方停止：相机绕到模型背后时眼球不往后翻。异常处理：计算失败时自动保持上一帧或回中。';
                advSec.content.appendChild(advNote);

                // ===== 手动微调 =====
                var tweakSec = createSection('手动微调（校准注视方向）', true);
                container.appendChild(tweakSec.element);

                tweakSec.content.appendChild(safeSlider('左右微调 (°)', -30, 30, settings.manualYaw, 0.5, function (v) {
                    settings.manualYaw = v; saveSettings();
                }));

                tweakSec.content.appendChild(safeSlider('上下微调 (°)', -30, 30, settings.manualPitch, 0.5, function (v) {
                    settings.manualPitch = v; saveSettings();
                }));

                tweakSec.content.appendChild(safeSlider('双眼汇聚 (°)', -20, 20, settings.convergence, 0.5, function (v) {
                    settings.convergence = v; saveSettings();
                }));

                var tweakNote = document.createElement('div');
                tweakNote.style.cssText = 'font-size:11px;color:var(--text-secondary);line-height:1.6;';
                tweakNote.textContent = '左右/上下微调：补偿自动跟随的偏差。双眼汇聚：正值=双眼向内靠拢（看近处），负值=向外分散。';
                tweakSec.content.appendChild(tweakNote);

                var resetEyeBtn = document.createElement('button');
                resetEyeBtn.className = 'mp-btn';
                resetEyeBtn.textContent = '重置眼球位置';
                resetEyeBtn.style.cssText = 'width:100%;padding:8px;font-size:13px;border-radius:var(--radius-sm);margin-top:4px;';
                resetEyeBtn.addEventListener('click', function () {
                    try {
                        mp.ui.showConfirmDialog('确认', '确定重置眼球位置和所有微调参数吗？').then(function (confirmed) {
                            if (confirmed) resetEyePosition();
                        });
                    } catch (e) { resetEyePosition(); }
                });
                tweakSec.content.appendChild(resetEyeBtn);

                var boneSec = createSection('眼球骨骼设置', false);
                container.appendChild(boneSec.element);

                var leftRow = document.createElement('div');
                leftRow.style.cssText = 'display:flex;align-items:center;gap:8px;';
                var leftLab = document.createElement('span');
                leftLab.style.cssText = 'font-size:13px;color:var(--text-secondary);min-width:60px;flex-shrink:0;';
                leftLab.textContent = '左眼骨骼';
                leftBoneSelectEl = document.createElement('select');
                leftBoneSelectEl.style.cssText = 'flex:1;padding:6px;border:1px solid var(--color-border);border-radius:var(--radius-sm);background:var(--color-surface);color:var(--text-primary);font-size:13px;';
                leftBoneSelectEl.addEventListener('change', function () {
                    settings.leftBoneName = leftBoneSelectEl.value;
                    clearEyeCache();
                    updateStatus();
                    saveSettings();
                });
                leftRow.appendChild(leftLab);
                leftRow.appendChild(leftBoneSelectEl);
                boneSec.content.appendChild(leftRow);

                var rightRow = document.createElement('div');
                rightRow.style.cssText = 'display:flex;align-items:center;gap:8px;';
                var rightLab = document.createElement('span');
                rightLab.style.cssText = 'font-size:13px;color:var(--text-secondary);min-width:60px;flex-shrink:0;';
                rightLab.textContent = '右眼骨骼';
                rightBoneSelectEl = document.createElement('select');
                rightBoneSelectEl.style.cssText = 'flex:1;padding:6px;border:1px solid var(--color-border);border-radius:var(--radius-sm);background:var(--color-surface);color:var(--text-primary);font-size:13px;';
                rightBoneSelectEl.addEventListener('change', function () {
                    settings.rightBoneName = rightBoneSelectEl.value;
                    clearEyeCache();
                    updateStatus();
                    saveSettings();
                });
                rightRow.appendChild(rightLab);
                rightRow.appendChild(rightBoneSelectEl);
                boneSec.content.appendChild(rightRow);

                var detectBtn = document.createElement('button');
                detectBtn.className = 'mp-btn';
                detectBtn.textContent = '重新自动检测眼球骨骼';
                detectBtn.style.cssText = 'width:100%;padding:8px;font-size:13px;border-radius:var(--radius-sm);';
                detectBtn.addEventListener('click', function () {
                    settings.leftBoneName = '';
                    settings.rightBoneName = '';
                    clearEyeCache();
                    refreshBoneDropdowns();
                    saveSettings();
                    toast('已重新检测眼球骨骼');
                });
                boneSec.content.appendChild(detectBtn);

                var boneInfo = document.createElement('div');
                boneInfo.style.cssText = 'font-size:11px;color:var(--text-secondary);line-height:1.6;';
                boneInfo.innerHTML = '自动识别：左目/右目、目Ｌ/目Ｒ、Eye_L/Eye_R、LeftEye/RightEye、左眼/右眼等。<br>若检测失败，请从上方下拉框手动选择。';
                boneSec.content.appendChild(boneInfo);

                var advSec = createSection('高级选项（坐标系适配）', false);
                container.appendChild(advSec.element);

                advSec.content.appendChild(safeToggle('反转左右方向', settings.invertYaw, function (v) {
                    settings.invertYaw = v; saveSettings();
                }));

                advSec.content.appendChild(safeToggle('反转上下方向', settings.invertPitch, function (v) {
                    settings.invertPitch = v; saveSettings();
                }));

                advSec.content.appendChild(safeToggle('交换左右/上下轴', settings.swapAxis, function (v) {
                    settings.swapAxis = v; saveSettings();
                }));

                var advNote = document.createElement('div');
                advNote.style.cssText = 'font-size:11px;color:var(--text-secondary);line-height:1.6;';
                advNote.textContent = '眼球转向相反→开对应「反转」；只有一个方向能动→开「交换轴」。观察上方调试数值变化可判断逻辑是否运行。';
                advSec.content.appendChild(advNote);

                var btnRow = document.createElement('div');
                btnRow.style.cssText = 'display:flex;gap:8px;margin-top:12px;';

                var resetBtn = document.createElement('button');
                resetBtn.className = 'mp-btn';
                resetBtn.textContent = '重置默认';
                resetBtn.style.flex = '1';
                resetBtn.addEventListener('click', function () {
                    try {
                        mp.ui.showConfirmDialog('确认', '确定重置所有设置为默认值吗？').then(function (confirmed) {
                            if (confirmed) doReset();
                        });
                    } catch (e) { doReset(); }
                });
                btnRow.appendChild(resetBtn);

                var saveBtn = document.createElement('button');
                saveBtn.className = 'mp-btn primary';
                saveBtn.textContent = '保存设置';
                saveBtn.style.flex = '1';
                saveBtn.addEventListener('click', function () {
                    saveSettings();
                    try { mp.ui.toast('设置已保存', 2000); } catch (e) { }
                });
                btnRow.appendChild(saveBtn);

                container.appendChild(btnRow);
            }

            function doReset() {
                stopTracking();
                clearEyeCache();
                resetSettings();
                curYaw = 0; curPitch = 0;
                while (container.childNodes.length > 2) {
                    container.removeChild(container.lastChild);
                }
                buildUI();
                refreshModelDropdown();
                if (settings.enabled) startTracking();
                saveSettings();
                toast('已重置为默认设置');
            }

            // ===== 设置持久化 =====
            function saveSettings() {
                try {
                    if (ctx && ctx.storage) ctx.storage.set('settings', settings);
                } catch (e) { }
            }

            function loadSettingsAsync() {
                try {
                    if (ctx && ctx.storage && ctx.storage.get) {
                        ctx.storage.get('settings').then(function (saved) {
                            if (saved) {
                                for (var key in saved) {
                                    if (saved.hasOwnProperty(key) && settings.hasOwnProperty(key)) {
                                        settings[key] = saved[key];
                                    }
                                }
                            }
                            refreshModelDropdown();
                            updateStatus();
                        }).catch(function () {
                            refreshModelDropdown();
                            updateStatus();
                        });
                    } else {
                        refreshModelDropdown();
                        updateStatus();
                    }
                } catch (e) {
                    refreshModelDropdown();
                    updateStatus();
                }
            }

            // ===== 生命周期 =====
            exports.createPanel = function (context) {
                ctx = context;
                scene = context.scene || (typeof mp !== 'undefined' && mp.scene ? mp.scene : null);

                container = document.createElement('div');
                container.style.cssText = 'padding:16px;color:var(--text-primary);display:flex;flex-direction:column;gap:8px;overflow-y:auto;height:100%;box-sizing:border-box;';

                try {
                    buildUI();
                } catch (e) {
                    var errDiv = document.createElement('div');
                    errDiv.style.cssText = 'color:var(--text-secondary);font-size:12px;padding:8px;';
                    errDiv.textContent = 'UI 构建出错: ' + e.message;
                    container.appendChild(errDiv);
                }

                try {
                    if (ctx && ctx.eventBus && typeof ctx.eventBus.on === 'function') {
                        var unsub = ctx.eventBus.on('model:loaded', function () {
                            clearEyeCache();
                            refreshModelDropdown();
                        });
                        unsubscribers.push(unsub);
                    }
                } catch (e) { }

                loadSettingsAsync();
                return container;
            };

            
            // ===== 集成层 API：供“面部相机”第一页快捷开关使用 =====
            exports.setEnabled = function (value) {
                var v = !!value;
                settings.enabled = v;
                if (v) {
                    startTracking();
                } else {
                    stopTracking();
                    restoreAllEyes();
                }
                saveSettings();
                updateStatus();
            };

            exports.isEnabled = function () {
                return !!settings.enabled;
            };

        exports.onShown = function () {
                refreshModelDropdown();
                if (settings.enabled && !animObserver) startTracking();
                updateStatus();
            };

            exports.onHidden = function () { };

            exports.dispose = function () {
                stopTracking();
                restoreAllEyes();
                clearEyeCache();
                unsubscribers.forEach(function (fn) { try { fn(); } catch (e) { } });
                unsubscribers = [];
                container = null;
                scene = null;
                ctx = null;
            };

        /* GAZE_MODULE_END */
        return exports;
    }

    var faceModule = createFaceCameraModule();
    var gazeModule = createGazeFollowModule();

    var root = null;
    var facePage = null;
    var gazePage = null;
    var faceTab = null;
    var gazeTab = null;
    var activePage = 'face';

    function makeTab(textLabel) {
        var b = document.createElement('button');
        b.type = 'button';
        b.textContent = textLabel;
        b.style.cssText =
            'flex:1;padding:9px 8px;border:0;border-bottom:2px solid transparent;' +
            'background:transparent;color:var(--text-secondary);font-size:13px;';
        return b;
    }

    function setActivePage(name) {
        activePage = name === 'gaze' ? 'gaze' : 'face';

        if (facePage) facePage.style.display = activePage === 'face' ? 'flex' : 'none';
        if (gazePage) gazePage.style.display = activePage === 'gaze' ? 'flex' : 'none';

        if (faceTab) {
            faceTab.style.color = activePage === 'face' ? 'var(--text-primary)' : 'var(--text-secondary)';
            faceTab.style.borderBottomColor = activePage === 'face' ? 'var(--color-accent)' : 'transparent';
        }
        if (gazeTab) {
            gazeTab.style.color = activePage === 'gaze' ? 'var(--text-primary)' : 'var(--text-secondary)';
            gazeTab.style.borderBottomColor = activePage === 'gaze' ? 'var(--color-accent)' : 'transparent';
        }

        try {
            if (activePage === 'face') {
                if (faceModule.onShown) faceModule.onShown();
            } else {
                if (gazeModule.onShown) gazeModule.onShown();
            }
        } catch (e) {
            try { console.error('[FaceCamera] page onShown failed:', e); } catch (_) {}
        }
    }

    exports.createPanel = function (context) {
        // 先创建两个独立模块；各自拥有自己的 exports/状态。
        // 不把两个原插件源码直接拼接到同一个 exports 对象中。
        var gazePageResult = null;
        var facePageResult = null;

        try {
            gazePageResult = gazeModule.createPanel(context);
        } catch (e) {
            gazePageResult = document.createElement('div');
            gazePageResult.textContent = '目光跟随初始化失败：' + (e && e.message ? e.message : e);
        }

        try {
            facePageResult = faceModule.createPanel(context, {
                getGazeEnabled: function () {
                    return gazeModule.isEnabled ? gazeModule.isEnabled() : false;
                },
                setGazeEnabled: function (v) {
                    if (gazeModule.setEnabled) gazeModule.setEnabled(v);
                }
            });
        } catch (e) {
            facePageResult = document.createElement('div');
            facePageResult.textContent = '面部相机初始化失败：' + (e && e.message ? e.message : e);
        }

        root = document.createElement('div');
        root.style.cssText =
            'display:flex;flex-direction:column;width:100%;height:100%;' +
            'min-height:0;color:var(--text-primary);';

        var tabs = document.createElement('div');
        tabs.style.cssText =
            'display:flex;flex:0 0 auto;border-bottom:1px solid var(--color-border);';

        faceTab = makeTab('面部相机');
        gazeTab = makeTab('目光跟随');
        tabs.appendChild(faceTab);
        tabs.appendChild(gazeTab);
        root.appendChild(tabs);

        var pages = document.createElement('div');
        pages.style.cssText = 'display:flex;flex:1;min-height:0;overflow:hidden;';

        facePage = document.createElement('div');
        facePage.style.cssText = 'display:flex;flex:1;min-width:0;min-height:0;overflow:hidden;';
        if (facePageResult) facePage.appendChild(facePageResult);

        gazePage = document.createElement('div');
        gazePage.style.cssText = 'display:none;flex:1;min-width:0;min-height:0;overflow:hidden;';
        if (gazePageResult) gazePage.appendChild(gazePageResult);

        pages.appendChild(facePage);
        pages.appendChild(gazePage);
        root.appendChild(pages);

        faceTab.addEventListener('click', function () { setActivePage('face'); });
        gazeTab.addEventListener('click', function () { setActivePage('gaze'); });

        setActivePage('face');
        return root;
    };

    exports.onShown = function () {
        try {
            if (activePage === 'face') {
                if (faceModule.onShown) faceModule.onShown();
            } else {
                if (gazeModule.onShown) gazeModule.onShown();
            }
        } catch (e) {}
    };

    exports.onHidden = function () {
        // 不主动停用功能；与两个原插件的 onHidden 行为保持一致。
        try { if (faceModule.onHidden) faceModule.onHidden(); } catch (e) {}
        try { if (gazeModule.onHidden) gazeModule.onHidden(); } catch (e) {}
    };

    exports.dispose = function () {
        try { if (faceModule.dispose) faceModule.dispose(); } catch (e) {}
        try { if (gazeModule.dispose) gazeModule.dispose(); } catch (e) {}
        root = null;
        facePage = null;
        gazePage = null;
        faceTab = null;
        gazeTab = null;
    };

