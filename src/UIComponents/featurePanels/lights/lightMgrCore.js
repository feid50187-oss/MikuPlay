/**
 * Light Manager Plugin V3.2.1 - 灯光管理器插件（V3 合并灯光方向追踪器）
 *
 * V3 变更：
 * 1. 光源设置 / 光动画设置 双页切换（顶部左右按钮）
 * 2. 光动画页：动画组（一灯同一时间只属于一个组）＋ 三种动画模式：
 *    呼吸灯 / 交替 / 追踪灯（追踪灯完整移植 V6 骨骼 + MMD 动作数据自动跟随）
 * 3. 三组独立帧循环（呼吸 / 交替 / 追踪），互相 try/catch 隔离，防止代码互串
 * 4. 移动轨迹（平行/环形/随机）留待 V4
 *
 * 原有功能：
 * 1. 创建和管理多种类型的灯光（HemisphericLight, DirectionalLight, PointLight, SpotLight）
 * 2. 调整灯光颜色和强度
 * 3. 使用Gizmo移动灯光位置
 * 4. 支持显示/隐藏灯光和Gizmo
 * 5. 支持设置"最大同时生效灯光数"，解决 Babylon.js 默认单个材质最多受 4 盏灯影响、
 *    导致创建多盏灯时"灯光生效数量过少"的问题
 * 6. 为每个灯光（半球光除外）提供 ShadowGenerator 阴影发生器，可自由开关，
 *    并支持调整阴影贴图大小与启用模糊阴影（PCF）；半球光不支持阴影
 */




    // UI组件引用
    var Slider = mp.ui.Slider;
    var Dropdown = mp.ui.Dropdown;
    var RGBColorPicker = mp.ui.RGBColorPicker;
    var VectorInput = mp.ui.VectorInput;
    var toast = mp.ui.toast;

    // 插件状态
    var container = null;
    var scene = null;
    var pluginContext = null;
    // V3 双页容器引用（详情页关闭时需要按原状态还原 display）
    var pageLightEl = null;
    var pageAnimEl = null;
    var pageLightElDisplay = 'flex';
    var pageAnimElDisplay = 'none';
    var lights = new Map();
    var gizmoManager = null;
    var currentGizmoLight = null;
    var unsubscribers = [];
    var lightCounter = 0;
    var panelInitialized = false;

    // V2.1 性能缓存：避免单灯操作反复扫描整个场景。
    var materialCache = [];
    var materialCacheDirty = true;
    var shadowCasterCache = [];
    var shadowCasterCacheDirty = true;
    var batchUpdateDepth = 0;
    var pendingGlobalUpdate = false;
    var pendingScopeUpdate = false;
    var gizmoObservers = [];

    // ============================================================
    // V3 光动画系统：动画组 + 三种模式（呼吸灯 / 交替 / 追踪灯）
    // 三组独立帧循环（tickBreath / tickAlternate / tickTrack），互相 try/catch 隔离。
    // 一盏灯同一时间只属于一个动画组（加入新组时自动移出旧组）。
    // 追踪灯模式完整移植 V6 核心：骨骼/MMD Runtime 世界坐标 + 动作数据自动跟随。
    // ============================================================
    var ANIM_MODES = [
        { value: 'breath', label: '呼吸灯' },
        { value: 'alternate', label: '交替' },
        { value: 'track', label: '追踪灯' }
    ];
    var animGlobalEnabled = true;
    var animGroups = new Map();
    var animGroupCounter = 0;
    var animFrameObserver = null;
    var animLastTime = 0;
    var animDisposed = false;
    var globalAnimToggle = null;
    var animLightListHost = null;
    var animGroupsHost = null;
    var animCountLabel = null;
    var animSelectedLights = {};
    var animSelectAllBtn = null;
    var animAddGroupBtn = null;
    var animAddTargetDropdown = null;
    var animTargetHostEl = null;
    var ANIM_GROUP_MAX = 16;       // 最多16个动画组
    var ANIM_GROUP_LIGHT_MAX = 16; // 每组最多16盏灯

    var animNow = function () {
        return (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
    };
    // 规范要求：组件在 dispose() 时调用 component.dispose() 释放全局文档事件监听
    var animComponents = []; // 页面级常驻组件（全局光动画开关等）
    function disposeComp(c) {
        if (c && typeof c.dispose === 'function') { try { c.dispose(); } catch (e) {} }
    }
    function regComp(g, c) {
        if (!c) return;
        if (g) { (g._comps = g._comps || []).push(c); }
        else { animComponents.push(c); }
    }
    var _trackTargetVec = null;

    function safeCall(fn, fallback) {
        try { return fn(); } catch (e) { return fallback; }
    }

    function safeDisposeDropdownForAnim(dd) {
        if (dd && typeof dd.dispose === 'function') {
            try { dd.dispose(); } catch (e) {}
        }
    }

    function mkBtn(text, fn, primary) {
        var b = document.createElement('button');
        b.type = 'button';
        b.className = 'mp-btn' + (primary ? ' primary' : '');
        b.textContent = text;
        b.style.cssText = 'min-height:34px;font-size:12px;font-weight:600;';
        b.addEventListener('click', fn);
        return b;
    }

    function getAnimAimableLights() {
        // 返回光源设置页创建的灯光（同一插件内部，直接读灯光 Map）
        var arr = [];
        lights.forEach(function (info) { if (info && info.light) arr.push(info); });
        return arr;
    }

    function isAimableType(type) {
        return type === 'spot' || type === 'point';
    }

    function lightInfoById(id) {
        return lights.get(id) || null;
    }

    // ---------- 灯光与组的关系 ----------
    function removeLightFromAllGroups(lightId) {
        var changed = false;
        animGroups.forEach(function (g) {
            var i = g.lightIds.indexOf(lightId);
            if (i !== -1) { g.lightIds.splice(i, 1); changed = true; }
        });
        if (!changed) return;
        var empty = [];
        animGroups.forEach(function (g, id) { if (!g.lightIds.length) empty.push(id); });
        empty.forEach(function (id) { removeAnimGroup(id, true); });
        refreshGroupsUI();
        refreshAnimLightList();
    }

    function addLightsToAnimGroup(lightIds, targetGroupId) {
        var valid = [];
        lightIds.forEach(function (id) {
            if (lights.has(id) && valid.indexOf(id) === -1) valid.push(id);
        });
        if (!valid.length) { toast.info('请先在灯光列表中选择灯光', 1800); return; }
        if (valid.length > ANIM_GROUP_LIGHT_MAX) { toast.info('单个动画组最多16盏灯', 2000); return; }

        // 一灯一组：先把选中的灯从其它组移出（离开旧组后恢复其基础效果）
        var affected = [];
        animGroups.forEach(function (g) {
            var keep = g.lightIds.filter(function (id) { return valid.indexOf(id) === -1; });
            if (keep.length !== g.lightIds.length) { g.lightIds = keep; affected.push(g); }
        });
        affected.forEach(function (g) { restoreGroupEffects(g); });

        var g = null;
        if (targetGroupId && animGroups.has(targetGroupId)) {
            g = animGroups.get(targetGroupId);
            if (g.lightIds.length + valid.length > ANIM_GROUP_LIGHT_MAX) {
                toast.info('该动画组灯数超出上限（16盏），请先移除部分灯光', 2200);
                return;
            }
            valid.forEach(function (id) { if (g.lightIds.indexOf(id) === -1) g.lightIds.push(id); });
        } else {
            if (animGroups.size >= ANIM_GROUP_MAX) { toast.info('动画组数量已达上限（16个）', 2000); return; }
            animGroupCounter++;
            g = {
                id: 'ag_' + Date.now() + '_' + animGroupCounter,
                name: '动画组 ' + animGroupCounter,
                lightIds: valid.slice(),
                mode: 'breath',
                enabled: true,
                breath: { freq: 0.3, amp: 60 },
                alternate: { colorA: { r: 1, g: 1, b: 1 }, colorB: { r: 0.2, g: 0.4, b: 1 }, interval: 0.8, randomColors: false, _rand: null },
                track: { modelId: '', offset: [0, 0, 0], actionTracking: false, _offsetInput: null },
                _t: 0, _acc: 0, _phase: false,
                uiElement: null, bodyElement: null, paramsHost: null, modeButtons: null
            };
            animGroups.set(g.id, g);
        }

        animSelectedLights = {};
        refreshGroupsUI();
        refreshAnimLightList();
        refreshAnimTargetDropdown();
        toast.success('动画组已更新：' + g.name + '（' + g.lightIds.length + ' 盏灯）', 2000);
    }

    function restoreGroupEffects(g) {
        // 恢复呼吸/交替写入的强度与颜色；恢复追踪灯原始方向
        if (!g) return;
        g.lightIds.forEach(function (lightId) {
            var info = lightInfoById(lightId);
            if (!info || !info.light) return;
            if (g.mode === 'breath') {
                info.light.intensity = (Number(info.intensity) || 0) * globalIntensityMultiplier;
            } else if (g.mode === 'alternate') {
                try { info.light.diffuse = new BABYLON.Color3(info.color.r, info.color.g, info.color.b); } catch (e) {}
                if (info.mesh && info.mesh.material) {
                    try { info.mesh.material.emissiveColor = new BABYLON.Color3(info.color.r, info.color.g, info.color.b); } catch (e) {}
                }
            } else if (g.mode === 'track') {
                if (info._trackOriginalDirection) {
                    try { info.light.direction.copyFrom(info._trackOriginalDirection); } catch (e) {}
                }
            }
            info._trackOriginalDirection = null;
        });
    }

    function removeAnimGroup(id, silent) {
        var g = animGroups.get(id);
        if (!g) return;
        restoreGroupEffects(g);
        if (g.uiElement && g.uiElement.parentNode) g.uiElement.parentNode.removeChild(g.uiElement);
        animGroups.delete(id);
        refreshGroupsUI();
        refreshAnimTargetDropdown();
        if (!silent) toast.info('已删除：' + g.name, 1800);
    }

    function setGroupMode(g, mode) {
        if (!g || g.mode === mode) return;
        restoreGroupEffects(g);
        g.mode = mode;
        g._t = 0; g._acc = 0; g._phase = false;
        refreshGroupBody(g);
    }

    function setGroupEnabled(g, enabled) {
        enabled = !!enabled;
        if (g.enabled === enabled) return;
        if (!enabled) restoreGroupEffects(g);
        g.enabled = enabled;
    }

    // ---------- 三组独立帧循环 ----------
    function tickBreathAnim(dt) {
        var any = false;
        animGroups.forEach(function (g) {
            if (g.mode !== 'breath' || !g.enabled) return;
            any = true;
            g._t = (g._t || 0) + dt;
            var freq = Math.max(0.05, Math.min(2, Number(g.breath.freq) || 0.3));
            var amp = Math.max(0, Math.min(100, Number(g.breath.amp) || 0)) / 100;
            var wave = 0.5 + 0.5 * Math.sin(2 * Math.PI * freq * g._t);
            var k = 1 - amp + amp * wave;
            g.lightIds.forEach(function (lightId) {
                var info = lightInfoById(lightId);
                if (!info || !info.light) return;
                try { info.light.intensity = (Number(info.intensity) || 0) * globalIntensityMultiplier * k; } catch (e) {}
            });
        });
        return any;
    }

    function tickAlternateAnim(dt) {
        var any = false;
        animGroups.forEach(function (g) {
            if (g.mode !== 'alternate' || !g.enabled) return;
            any = true;
            g._acc = (g._acc || 0) + dt;
            var interval = Math.max(0.2, Math.min(5, Number(g.alternate.interval) || 0.8));
            if (g._acc >= interval) {
                g._acc = 0;
                g._phase = !g._phase;
                if (g.alternate.randomColors) g._rand = { r: Math.random(), g: Math.random(), b: Math.random() };
            }
            // 实时读取取色器当前值（若组件有 onChange 也会同步到 colorA/colorB）
            var cA = g.alternate.colorA, cB = g.alternate.colorB;
            if (g.alternate._pickerA) {
                var vA = safeCall(function () { return g.alternate._pickerA.getValue ? g.alternate._pickerA.getValue() : null; }, null);
                if (vA && typeof vA.r === 'number') cA = vA;
            }
            if (g.alternate._pickerB) {
                var vB = safeCall(function () { return g.alternate._pickerB.getValue ? g.alternate._pickerB.getValue() : null; }, null);
                if (vB && typeof vB.r === 'number') cB = vB;
            }
            var c = g._phase ? cB : cA;
            if (g.alternate.randomColors && g._rand) c = g._rand;
            var col = new BABYLON.Color3(
                Math.max(0, Math.min(1, Number(c.r) || 0)),
                Math.max(0, Math.min(1, Number(c.g) || 0)),
                Math.max(0, Math.min(1, Number(c.b) || 0))
            );
            g.lightIds.forEach(function (lightId) {
                var info = lightInfoById(lightId);
                if (!info || !info.light) return;
                try { info.light.diffuse = col; } catch (e) {}
                if (info.mesh && info.mesh.material) {
                    try { info.mesh.material.emissiveColor = col; } catch (e) {}
                }
            });
        });
        return any;
    }

    // ================= 追踪灯：V6 核心移植（组级） =================
    var TRACK_MIN_DISTANCE = 0.001;
    var TRACK_CHEST_KEYWORDS = ['上半身2', '上半身２', '胸', 'chest', '上半身', 'spine2', 'spine1', 'spine', '首', 'neck', 'センター', 'center'];
    var TRACK_ACTION_BONE_PREFERRED = ['センター', 'Center', 'センター先', '全ての親', '全亲', '全親', 'All Parent', 'AllParent'];
    var _trackTmpDir = null, _trackTmpScale = null, _trackTmpQuat = null, _trackTmpTrans = null;

    function ensureTrackBuffers() {
        if (!_trackTmpDir) _trackTmpDir = new BABYLON.Vector3(0, -1, 0);
        if (!_trackTmpScale) _trackTmpScale = new BABYLON.Vector3(1, 1, 1);
        if (!_trackTmpQuat) _trackTmpQuat = new BABYLON.Quaternion();
        if (!_trackTmpTrans) _trackTmpTrans = new BABYLON.Vector3(0, 0, 0);
    }

    function isVecFinite(v) {
        return !!v && isFinite(v.x) && isFinite(v.y) && isFinite(v.z);
    }

    function getModelsForTrack() {
        try { return (mp.model && typeof mp.model.list === 'function' ? mp.model.list() : []) || []; } catch (e) { return []; }
    }

    function findModelByIdForTrack(id) {
        if (!id) return null;
        var list = getModelsForTrack();
        for (var i = 0; i < list.length; i++) {
            if (String(list[i].id) === String(id)) return list[i];
        }
        return null;
    }

    function isLightAlive(light) {
        if (!light || !scene || !scene.lights) return false;
        return scene.lights.indexOf(light) !== -1;
    }

    function collectTrackBones(model) {
        var result = [];
        var seen = {};
        if (!model || !model.mesh) return result;
        var root = model.mesh;
        function walkMesh(mesh) {
            if (!mesh) return;
            var sk = mesh.skeleton;
            if (sk && sk.bones && sk.bones.length) {
                for (var i = 0; i < sk.bones.length; i++) {
                    var bone = sk.bones[i];
                    if (!bone || seen[bone.uniqueId]) continue;
                    seen[bone.uniqueId] = true;
                    result.push({ key: 'sk_' + bone.uniqueId, bone: bone, boneType: 'skeleton', name: String(bone.name || ('骨 ' + bone.uniqueId)) });
                }
            }
            var kids = safeCall(function () { return mesh.getChildMeshes(false) || []; }, []);
            for (var j = 0; j < kids.length; j++) walkMesh(kids[j]);
        }
        walkMesh(root);
        if (result.length === 0) {
            var descs = safeCall(function () { return root.getDescendants(true) || []; }, []);
            for (var k = 0; k < descs.length; k++) {
                var n = descs[k];
                if (!n || !n.name) continue;
                if (n instanceof BABYLON.AbstractMesh) continue;
                if (seen[n.uniqueId]) continue;
                seen[n.uniqueId] = true;
                result.push({ key: 'tn_' + n.uniqueId, bone: n, boneType: 'transform', name: String(n.name) });
            }
        }
        result.sort(function (a, b) { return String(a.name).localeCompare(String(b.name), 'ja'); });
        return result;
    }

    function pickDefaultChestBoneKey(bones) {
        if (!bones || !bones.length) return '';
        for (var p = 0; p < TRACK_CHEST_KEYWORDS.length; p++) {
            var kw = TRACK_CHEST_KEYWORDS[p];
            for (var i = 0; i < bones.length; i++) {
                if (String(bones[i].name || '').indexOf(kw) !== -1) return bones[i].key;
            }
        }
        return '';
    }

    function getMmdModelForTrack(modelId) {
        var key = String(modelId || '');
        if (!key) return null;
        var app = safeCall(function () { return pluginContext && pluginContext.app; }, null);
        var manager = safeCall(function () { return app && typeof app.getModelManager === 'function' ? app.getModelManager() : null; }, null);
        if (!manager || typeof manager.getMmdModel !== 'function') return null;
        return safeCall(function () { return manager.getMmdModel(modelId); }, null);
    }

    function getRuntimeBonesForTrack(mmd) {
        if (!mmd) return [];
        var rb = safeCall(function () { return mmd.runtimeBones; }, null);
        if (!rb) return [];
        if (Array.isArray(rb)) return rb;
        if (typeof rb.length === 'number') {
            var out = [];
            for (var i = 0; i < rb.length; i++) out.push(rb[i]);
            return out;
        }
        return [];
    }

    // V6 动作数据路径：MmdRuntimeBone.worldMatrix × mesh.worldMatrix → 真实世界坐标
    function computeActionTargetWorldPositionForTrack(model, out) {
        var mmd = getMmdModelForTrack(model.id);
        if (!mmd) return false;
        var bones = getRuntimeBonesForTrack(mmd);
        if (!bones || !bones.length) return false;
        var targetBone = null;
        for (var p = 0; p < TRACK_ACTION_BONE_PREFERRED.length && !targetBone; p++) {
            for (var j = 0; j < bones.length; j++) {
                var pb = bones[j];
                if (String(pb && (pb.name || pb.boneName || pb._name) || '') === TRACK_ACTION_BONE_PREFERRED[p]) { targetBone = pb; break; }
            }
        }
        if (!targetBone) return false;
        var boneWorldMatrix = safeCall(function () { return new BABYLON.Matrix(); }, null);
        if (!boneWorldMatrix) return false;
        var mesh = safeCall(function () { return mmd.mesh || model.mesh; }, null);
        if (!mesh) return false;
        safeCall(function () { mesh.computeWorldMatrix(true); }, null);
        var meshWorldMatrix = safeCall(function () { return mesh.getWorldMatrix(); }, null);
        if (!meshWorldMatrix) return false;
        if (typeof targetBone.getWorldMatrixToRef === 'function') {
            try {
                targetBone.getWorldMatrixToRef(boneWorldMatrix);
                boneWorldMatrix.multiplyToRef(meshWorldMatrix, boneWorldMatrix);
                if (typeof boneWorldMatrix.getTranslationToRef === 'function') {
                    boneWorldMatrix.getTranslationToRef(out);
                    if (isVecFinite(out)) return true;
                }
            } catch (e) {}
        }
        if (typeof targetBone.getWorldTranslationToRef === 'function') {
            try {
                targetBone.getWorldTranslationToRef(out);
                if (isVecFinite(out)) return true;
            } catch (e) {}
        }
        return false;
    }

    function computeModelWorldPositionForTrack(model, out) {
        var root = safeCall(function () { return model && model.mesh; }, null);
        if (!root) return false;
        safeCall(function () { root.computeWorldMatrix(true); }, null);
        var wm = safeCall(function () { return root.getWorldMatrix(); }, null);
        if (wm && wm.decompose) {
            _trackTmpScale.set(1, 1, 1); _trackTmpQuat.set(0, 0, 0, 1); _trackTmpTrans.set(0, 0, 0);
            try { wm.decompose(_trackTmpScale, _trackTmpQuat, _trackTmpTrans); } catch (e) { return false; }
            if (isVecFinite(_trackTmpTrans)) { out.copyFrom(_trackTmpTrans); return true; }
        }
        var p = safeCall(function () { return root.getAbsolutePosition ? root.getAbsolutePosition() : null; }, null);
        if (p && isVecFinite(p)) { out.copyFrom(p); return true; }
        return false;
    }

    function computeBoneWorldMatrixForTrack(bone, rootMesh) {
        if (!bone) return null;
        if (typeof bone.getAbsoluteMatrix === 'function') {
            var am = safeCall(function () { return bone.getAbsoluteMatrix(); }, null);
            if (!am) return null;
            var wm = null;
            if (rootMesh) {
                safeCall(function () { rootMesh.computeWorldMatrix(true); }, null);
                wm = safeCall(function () { return rootMesh.getWorldMatrix(); }, null);
            }
            if (wm) return am.multiply(wm);
            return am.clone ? am.clone() : am;
        }
        if (bone.computeWorldMatrix && bone.getWorldMatrix) {
            safeCall(function () { bone.computeWorldMatrix(true); }, null);
            return safeCall(function () { return bone.getWorldMatrix(); }, null);
        }
        return null;
    }

    function computeTrackTargetWorldPosition(g, model, out) {
        ensureTrackBuffers();
        // 动作数据追踪优先：读取 MMD Runtime 骨骼最终世界坐标
        if (g.track.actionTracking) {
            if (computeActionTargetWorldPositionForTrack(model, out)) return true;
        }
        // 默认骨骼路径：自动选胸部骨骼（与 V6 一致）
        var bones = collectTrackBones(model);
        var boneKey = pickDefaultChestBoneKey(bones);
        if (boneKey) {
            for (var i = 0; i < bones.length; i++) {
                if (bones[i].key === boneKey) {
                    var wm = computeBoneWorldMatrixForTrack(bones[i].bone, model.mesh);
                    if (wm) {
                        _trackTmpScale.set(1, 1, 1); _trackTmpQuat.set(0, 0, 0, 1); _trackTmpTrans.set(0, 0, 0);
                        try { wm.decompose(_trackTmpScale, _trackTmpQuat, _trackTmpTrans); } catch (e) { break; }
                        if (isVecFinite(_trackTmpTrans)) { out.copyFrom(_trackTmpTrans); return true; }
                    }
                    break;
                }
            }
        }
        // 兜底：模型中心
        return computeModelWorldPositionForTrack(model, out);
    }

    function smoothTrackTarget(info, target, dt, response) {
        if (!info._smoothPos) info._smoothPos = target.clone();
        if (!isVecFinite(info._smoothPos)) info._smoothPos.copyFrom(target);
        var alpha = 1 - Math.exp(-response * 12 * Math.max(0.001, Math.min(dt, 0.1)));
        alpha = Math.max(0.001, Math.min(1, alpha));
        info._smoothPos.x += (target.x - info._smoothPos.x) * alpha;
        info._smoothPos.y += (target.y - info._smoothPos.y) * alpha;
        info._smoothPos.z += (target.z - info._smoothPos.z) * alpha;
        return info._smoothPos;
    }

    function tickTrackAnim(dt) {
        var any = false;
        animGroups.forEach(function (g) {
            if (g.mode !== 'track' || !g.enabled) return;
            var model = findModelByIdForTrack(g.track.modelId);
            if (!model) return;
            if (!_trackTargetVec) _trackTargetVec = new BABYLON.Vector3(0, 0, 0);
            var target = _trackTargetVec;
            if (!computeTrackTargetWorldPosition(g, model, target)) return;
            any = true;

            var dead = [];
            g.lightIds.forEach(function (lightId) {
                var info = lightInfoById(lightId);
                if (!info || !info.light) return;
                if (!isAimableType(info.type)) return;
                if (!isLightAlive(info.light)) { dead.push(lightId); return; }
                try {
                    if (!info._trackOriginalDirection && info.light.direction) {
                        info._trackOriginalDirection = info.light.direction.clone();
                    }
                    var tgt = smoothTrackTarget(info, target, dt, 0.35);
                    var off = g.track.offset;
                    if (g.track._offsetInput) {
                        var ov = safeCall(function () { return g.track._offsetInput.getValue ? g.track._offsetInput.getValue() : null; }, null);
                        if (ov) off = ov;
                    }
                    var tx = tgt.x + (Number(off[0]) || 0);
                    var ty = tgt.y + (Number(off[1]) || 0);
                    var tz = tgt.z + (Number(off[2]) || 0);
                    if (!isFinite(tx) || !isFinite(ty) || !isFinite(tz)) return;
                    if (info.type === 'point') {
                        // 点光灯：位置跟随目标 + 偏移
                        info.light.position.x = tx;
                        info.light.position.y = ty;
                        info.light.position.z = tz;
                        return;
                    }
                    // 聚光灯：位置不动，只改方向（舞台追光）
                    var dx = tx - info.light.position.x;
                    var dy = ty - info.light.position.y;
                    var dz = tz - info.light.position.z;
                    var len = Math.sqrt(dx * dx + dy * dy + dz * dz);
                    if (!isFinite(len) || len < TRACK_MIN_DISTANCE) return;
                    _trackTmpDir.set(dx / len, dy / len, dz / len);
                    if (!isVecFinite(_trackTmpDir)) return;
                    info.light.direction.copyFrom(_trackTmpDir);
                } catch (e) {
                    console.warn('[LightManagerV3] 追踪灯单灯异常，已跳过:', e);
                }
            });
            if (dead.length) {
                dead.forEach(function (lightId) {
                    var i = g.lightIds.indexOf(lightId);
                    if (i !== -1) g.lightIds.splice(i, 1);
                });
                refreshGroupsUI();
            }
        });
        return any;
    }

    // 统一光动画帧循环：三组独立调用，互相隔离
    function animTick() {
        if (animDisposed) return;
        if (!animGlobalEnabled) return;
        if (!scene || !scene.lights) return;
        var now = animNow();
        var dt = animLastTime ? (now - animLastTime) / 1000 : (1 / 60);
        animLastTime = now;
        if (!isFinite(dt) || dt <= 0) dt = 1 / 60;
        dt = Math.min(dt, 0.1);
        try { tickBreathAnim(dt); } catch (e) { console.warn('[LightManagerV3] 呼吸动画异常:', e); }
        try { tickAlternateAnim(dt); } catch (e) { console.warn('[LightManagerV3] 交替动画异常:', e); }
        try { tickTrackAnim(dt); } catch (e) { console.warn('[LightManagerV3] 追踪动画异常:', e); }
    }

    // ---------- 光动画页面 UI ----------
    function addAnimParamSlider(host, label, min, max, step, value, onChange, format) {
        var cell = document.createElement('div');
        cell.style.cssText = 'margin-bottom:6px;';
        var head = document.createElement('div');
        head.style.cssText = 'display:flex;justify-content:space-between;align-items:center;margin-bottom:2px;';
        var lab = document.createElement('div');
        lab.textContent = label;
        lab.style.cssText = 'font-size:11px;color:var(--text-secondary);font-weight:600;';
        head.appendChild(lab);
        var val = document.createElement('span');
        val.textContent = format ? format(Number(value)) : String(value);
        val.style.cssText = 'font-size:11px;font-weight:700;';
        head.appendChild(val);
        cell.appendChild(head);
        var slider = document.createElement('input');
        slider.type = 'range';
        slider.min = min; slider.max = max; slider.step = step; slider.value = value;
        slider.style.cssText = 'width:100%;height:24px;margin:0;';
        slider.addEventListener('input', function () {
            var v = Number(slider.value);
            val.textContent = format ? format(v) : String(v);
            onChange(v);
        });
        cell.appendChild(slider);
        host.appendChild(cell);
        return slider;
    }

    function refreshAnimLightList() {
        if (!animLightListHost) return;
        animLightListHost.innerHTML = '';
        var groupedIds = {};
        animGroups.forEach(function(g){ (g.lightIds || []).forEach(function(id){ groupedIds[id] = true; }); });
        var arr = getAnimAimableLights().filter(function(info){ return !groupedIds[info.id]; });
        if (!arr.length) {
            var empty = document.createElement('div');
            empty.textContent = '— 暂无灯光，请先到「光源设置」页创建灯光 —';
            empty.style.cssText = 'font-size:11px;color:var(--text-disabled);';
            animLightListHost.appendChild(empty);
            return;
        }
        arr.forEach(function (info) {
            var row = document.createElement('label');
            row.style.cssText = 'display:flex;align-items:center;gap:6px;min-height:28px;font-size:12px;cursor:pointer;';
            var cb = document.createElement('input');
            cb.type = 'checkbox';
            cb.checked = !!animSelectedLights[info.id];
            cb.addEventListener('change', function () {
                if (cb.checked) animSelectedLights[info.id] = true;
                else delete animSelectedLights[info.id];
            });
            row.appendChild(cb);
            var name = document.createElement('span');
            name.textContent = (info.locked ? '🔒 ' : '') + info.name;
            name.style.cssText = 'overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';
            row.appendChild(name);
            var type = document.createElement('span');
            type.textContent = info.type;
            type.style.cssText = 'font-size:10px;color:var(--text-secondary);margin-left:auto;';
            row.appendChild(type);
            animLightListHost.appendChild(row);
        });
    }

    function refreshAnimTargetDropdown() {
        var host = animTargetHostEl;
        if (!host) return;
        var options = [{ value: '', label: '新建动画组' }];
        animGroups.forEach(function (g) { options.push({ value: g.id, label: g.name }); });
        safeDisposeDropdownForAnim(animAddTargetDropdown);
        host.innerHTML = '';
        animAddTargetDropdown = new Dropdown({ options: options, selectedValue: '', placeholder: '选择加入目标' });
        host.appendChild(animAddTargetDropdown.element);
    }

    function buildAnimationPage(root) {
        // 1) 全局控制
        var secGlobal = document.createElement('div');
        secGlobal.style.cssText = 'background:var(--color-surface);border-radius:var(--radius-md);padding:10px 12px;border:1px solid var(--color-border);';
        globalAnimToggle = new mp.ui.ToggleSwitch({ label: '光动画', initialState: animGlobalEnabled });
        regComp(null, globalAnimToggle);
        globalAnimToggle.onChange(function (enabled) {
            animGlobalEnabled = !!enabled;
            if (!animGlobalEnabled) {
                animGroups.forEach(function (g) { restoreGroupEffects(g); });
            }
            if (pluginContext) pluginContext.storage.set('animGlobalEnabled', animGlobalEnabled);
        });
        secGlobal.appendChild(globalAnimToggle.element);
        root.appendChild(secGlobal);

        // 2) 灯光选择区
        var secSel = document.createElement('div');
        secSel.style.cssText = 'background:var(--color-surface);border-radius:var(--radius-md);padding:10px 12px;border:1px solid var(--color-border);';
        var sTitle = document.createElement('div');
        sTitle.textContent = '灯光列表（勾选后加入动画组）';
        sTitle.style.cssText = 'font-size:14px;font-weight:700;margin-bottom:6px;';
        secSel.appendChild(sTitle);
        animLightListHost = document.createElement('div');
        animLightListHost.style.cssText = 'display:flex;flex-direction:column;gap:4px;max-height:180px;overflow-y:auto;margin-bottom:8px;';
        secSel.appendChild(animLightListHost);

        var targetWrap = document.createElement('div');
        targetWrap.style.cssText = 'margin-bottom:6px;';
        var tLabel = document.createElement('div');
        tLabel.textContent = '加入方式';
        tLabel.style.cssText = 'font-size:11px;color:var(--text-secondary);margin-bottom:4px;';
        targetWrap.appendChild(tLabel);
        var targetHost = document.createElement('div');
        targetWrap.appendChild(targetHost);
        animTargetHostEl = targetHost;
        secSel.appendChild(targetWrap);

        var selRow = document.createElement('div');
        selRow.style.cssText = 'display:grid;grid-template-columns:1fr 1fr;gap:6px;';
        animSelectAllBtn = mkBtn('全选', function () {
            getAnimAimableLights().forEach(function (info) { animSelectedLights[info.id] = true; });
            refreshAnimLightList();
        });
        var clearSelBtn = mkBtn('清空选择', function () { animSelectedLights = {}; refreshAnimLightList(); });
        selRow.appendChild(animSelectAllBtn);
        selRow.appendChild(clearSelBtn);
        secSel.appendChild(selRow);

        var addWrap = document.createElement('div');
        addWrap.style.cssText = 'margin-top:6px;';
        animAddGroupBtn = mkBtn('＋ 加入动画组', function () {
            var ids = Object.keys(animSelectedLights).filter(function (id) { return animSelectedLights[id]; });
            addLightsToAnimGroup(ids, animAddTargetDropdown ? animAddTargetDropdown.getValue() : ''); refreshAnimLightList();
        }, true);
        addWrap.appendChild(animAddGroupBtn);
        secSel.appendChild(addWrap);
        root.appendChild(secSel);

        // 3) 动画组列表
        var secGroups = document.createElement('div');
        secGroups.style.cssText = 'background:var(--color-surface);border-radius:var(--radius-md);padding:10px 12px;border:1px solid var(--color-border);';
        var groupsTitleRow = document.createElement('div');
        groupsTitleRow.style.cssText = 'display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;';
        var groupsTitle = document.createElement('div');
        groupsTitle.textContent = '动画组';
        groupsTitle.style.cssText = 'font-size:14px;font-weight:700;';
        animCountLabel = document.createElement('span');
        animCountLabel.textContent = '(0)';
        animCountLabel.style.cssText = 'font-size:11px;color:var(--text-secondary);';
        groupsTitleRow.appendChild(groupsTitle);
        groupsTitleRow.appendChild(animCountLabel);
        secGroups.appendChild(groupsTitleRow);
        animGroupsHost = document.createElement('div');
        animGroupsHost.style.cssText = 'display:flex;flex-direction:column;gap:8px;';
        secGroups.appendChild(animGroupsHost);
        root.appendChild(secGroups);

        refreshAnimLightList();
        refreshAnimTargetDropdown();
        refreshGroupsUI();
    }

    function refreshGroupsUI() {
        if (!animGroupsHost) return;
        // 重建前释放各组旧组件的全局文档监听
        animGroups.forEach(function (g) {
            (g._comps || []).forEach(disposeComp);
            g._comps = [];
        });
        animGroupsHost.innerHTML = '';
        animGroups.forEach(function (g) {
            animGroupsHost.appendChild(buildGroupElement(g));
        });
        if (animCountLabel) animCountLabel.textContent = '(' + animGroups.size + ')';
        refreshAnimTargetDropdown();
    }

    function buildGroupElement(g) {
        var wrap = document.createElement('div');
        wrap.className = 'anim-group';
        wrap.style.cssText = 'border:1px solid var(--color-border);border-radius:var(--radius-md);background:var(--color-bg);overflow:hidden;';
        g.uiElement = wrap;

        // 头行：开关 + 名称 + 灯数 + 展开 + 删除
        var head = document.createElement('div');
        head.style.cssText = 'display:flex;align-items:center;gap:6px;padding:6px 8px;min-height:34px;';
        var toggle = new mp.ui.ToggleSwitch({ label: '', initialState: g.enabled });
        toggle.onChange(function (en) { setGroupEnabled(g, en); });
        regComp(g, toggle);
        head.appendChild(toggle.element);
        var name = document.createElement('div');
        name.textContent = g.name;
        name.style.cssText = 'font-weight:700;font-size:12px;flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';
        head.appendChild(name);
        var count = document.createElement('span');
        count.textContent = g.lightIds.length + ' 盏';
        count.style.cssText = 'font-size:10px;color:var(--text-secondary);';
        head.appendChild(count);
        var exp = document.createElement('button');
        exp.className = 'mp-btn small'; exp.type = 'button'; exp.textContent = '展开';
        exp.style.cssText = 'min-width:44px;min-height:28px;font-size:11px;';
        exp.addEventListener('click', function () {
            var open = g.bodyElement.style.display !== 'none';
            g.bodyElement.style.display = open ? 'none' : 'block';
            exp.textContent = open ? '展开' : '收起';
        });
        head.appendChild(exp);
        var del = document.createElement('button');
        del.className = 'mp-btn danger small'; del.type = 'button'; del.textContent = '删除';
        del.style.cssText = 'min-width:44px;min-height:28px;font-size:11px;';
        del.addEventListener('click', function () {
            if (window.confirm('确定删除动画组“' + g.name + '”吗？灯光本身不会被删除。')) removeAnimGroup(g.id, false);
        });
        head.appendChild(del);
        wrap.appendChild(head);

        var body = document.createElement('div');
        body.style.cssText = 'border-top:1px solid var(--color-border);padding:8px;display:none;';
        g.bodyElement = body;
        wrap.appendChild(body);
        buildGroupBody(g, body);
        return wrap;
    }

    function buildGroupBody(g, body) {
        body.innerHTML = '';
        // 模式单选
        var modeLabel = document.createElement('div');
        modeLabel.textContent = '动画方式';
        modeLabel.style.cssText = 'font-size:11px;color:var(--text-secondary);margin-bottom:5px;';
        body.appendChild(modeLabel);
        var modeRow = document.createElement('div');
        modeRow.style.cssText = 'display:grid;grid-template-columns:repeat(3,1fr);gap:5px;margin-bottom:8px;';
        ANIM_MODES.forEach(function (m) {
            var b = document.createElement('button');
            b.type = 'button'; b.className = 'mp-btn small';
            b.textContent = m.label;
            b.style.cssText = 'min-height:32px;font-size:12px;font-weight:600;';
            b.addEventListener('click', function () { setGroupMode(g, m.value); });
            modeRow.appendChild(b);
        });
        body.appendChild(modeRow);
        g.modeButtons = modeRow.children;

        // 组内灯光
        var lightLabel = document.createElement('div');
        lightLabel.textContent = '组内灯光';
        lightLabel.style.cssText = 'font-size:11px;color:var(--text-secondary);margin:6px 0 4px;';
        body.appendChild(lightLabel);
        var lightChips = document.createElement('div');
        lightChips.style.cssText = 'display:flex;flex-wrap:wrap;gap:4px;';
        g.lightIds.forEach(function (lightId) {
            var info = lightInfoById(lightId);
            var chip = document.createElement('span');
            chip.textContent = info ? info.name : lightId;
            chip.style.cssText = 'font-size:10px;background:var(--color-border);border-radius:10px;padding:2px 7px;';
            lightChips.appendChild(chip);
        });
        body.appendChild(lightChips);

        // 参数容器（按模式展开）
        var params = document.createElement('div');
        params.style.cssText = 'margin-top:8px;';
        body.appendChild(params);
        g.paramsHost = params;
        refreshGroupBody(g);
    }

    function refreshGroupBody(g) {
        if (!g.paramsHost) return;
        // 高亮当前模式
        if (g.modeButtons) {
            for (var i = 0; i < g.modeButtons.length; i++) {
                var active = ANIM_MODES[i].value === g.mode;
                g.modeButtons[i].classList.toggle('primary', active);
                g.modeButtons[i].style.opacity = active ? '1' : '0.42';
            }
        }
        var host = g.paramsHost;
        // 重建前释放该组旧组件的全局文档监听
        (g._comps || []).forEach(disposeComp);
        g._comps = [];
        host.innerHTML = '';
        if (g.mode === 'breath') {
            addAnimParamSlider(host, '呼吸频率', 0.05, 2, 0.05, g.breath.freq, function (v) { g.breath.freq = v; }, function (v) { return v.toFixed(2) + ' Hz'; });
            addAnimParamSlider(host, '呼吸幅度', 0, 100, 1, g.breath.amp, function (v) { g.breath.amp = v; }, function (v) { return Math.round(v) + ' %'; });
            var bTip = document.createElement('div');
            bTip.textContent = '幅度 0% = 常亮；100% = 在 0~2 倍基础亮度间呼吸。';
            bTip.style.cssText = 'font-size:10px;color:var(--text-secondary);line-height:1.4;';
            host.appendChild(bTip);
        } else if (g.mode === 'alternate') {
            var rowA = document.createElement('div');
            rowA.style.cssText = 'margin-bottom:6px;';
            g.alternate._pickerA = new RGBColorPicker({ label: '颜色 A', color: g.alternate.colorA, mode: 'popup' });
            regComp(g, g.alternate._pickerA);
            rowA.appendChild(g.alternate._pickerA.element);
            host.appendChild(rowA);
            var rowB = document.createElement('div');
            rowB.style.cssText = 'margin-bottom:6px;';
            g.alternate._pickerB = new RGBColorPicker({ label: '颜色 B', color: g.alternate.colorB, mode: 'popup' });
            regComp(g, g.alternate._pickerB);
            rowB.appendChild(g.alternate._pickerB.element);
            host.appendChild(rowB);
            addAnimParamSlider(host, '切换间隔', 0.2, 5, 0.1, g.alternate.interval, function (v) { g.alternate.interval = v; }, function (v) { return v.toFixed(1) + ' s'; });
            var rand = new mp.ui.ToggleSwitch({ label: '动态随机颜色', initialState: !!g.alternate.randomColors });
            rand.onChange(function (en) {
                g.alternate.randomColors = !!en;
                if (!en) g._rand = null;
            });
            regComp(g, rand);
            host.appendChild(rand.element);
        } else if (g.mode === 'track') {
            var mLabel = document.createElement('div');
            mLabel.textContent = '追踪目标模型';
            mLabel.style.cssText = 'font-size:11px;color:var(--text-secondary);margin-bottom:4px;';
            host.appendChild(mLabel);
            var mHost = document.createElement('div');
            var models = getModelsForTrack().filter(function (m) { return m && m.mesh; });
            var mOptions = models.map(function (m) { return { value: String(m.id), label: m.name || String(m.id) }; });
            if (!mOptions.length) mOptions = [{ value: '', label: '— 场景中暂无模型 —' }];
            var keep = g.track.modelId && mOptions.some(function (o) { return o.value === g.track.modelId; }) ? g.track.modelId : mOptions[0].value;
            if (keep) g.track.modelId = keep;
            var mDropdown = new Dropdown({ options: mOptions, selectedValue: keep, placeholder: '选择目标模型' });
            mDropdown.onChange(function (v) { g.track.modelId = String(v || ''); });
            regComp(g, mDropdown);
            mHost.appendChild(mDropdown.element);
            host.appendChild(mHost);

            var offInput = new VectorInput({
                label: '瞄准偏移',
                components: [
                    { name: 'X', value: Number(g.track.offset[0]) || 0, min: -200, max: 200, step: 0.1 },
                    { name: 'Y', value: Number(g.track.offset[1]) || 0, min: -200, max: 200, step: 0.1 },
                    { name: 'Z', value: Number(g.track.offset[2]) || 0, min: -200, max: 200, step: 0.1 }
                ]
            });
            regComp(g, offInput);
            var ov0 = safeCall(function () { return offInput.getValue ? offInput.getValue() : null; }, null);
            if (ov0) g.track.offset = [Number(ov0[0]) || 0, Number(ov0[1]) || 0, Number(ov0[2]) || 0];
            if (offInput.onChange) {
                offInput.onChange(function (v) {
                    g.track.offset = [Number(v && v[0]) || 0, Number(v && v[1]) || 0, Number(v && v[2]) || 0];
                });
            } else {
                g.track._offsetInput = offInput;
            }
            host.appendChild(offInput.element);

            var act = new mp.ui.ToggleSwitch({ label: '动作数据方向追踪（V6）', initialState: !!g.track.actionTracking });
            act.onChange(function (en) { g.track.actionTracking = !!en; });
            regComp(g, act);
            host.appendChild(act.element);
            var hint = document.createElement('div');
            hint.textContent = '读取 MikuEngine/MMD Runtime 骨骼世界矩阵自动跟随；默认瞄准胸部骨骼，无骨骼时退回模型中心。聚光灯只改方向，点光灯跟随位置。';
            hint.style.cssText = 'font-size:10px;color:var(--text-secondary);line-height:1.4;margin-top:4px;';
            host.appendChild(hint);
        }
    }

    // 模型移除后清理失效的追踪目标
    function cleanupTrackModelRefs() {
        var validIds = {};
        getModelsForTrack().forEach(function (m) { validIds[String(m.id)] = true; });
        animGroups.forEach(function (g) {
            if (g.mode === 'track' && g.track.modelId && !validIds[g.track.modelId]) g.track.modelId = '';
        });
        refreshGroupsUI();
    }

    // 最大同时生效灯光数（Babylon.js 默认 4，超过后多余的灯不会对材质生效）
    var MAX_LIGHTS_MIN = 4;
    var MAX_LIGHTS_MAX = 24;
    var MAX_LIGHTS_DEFAULT = 8;
    // 灯光管理器创建上限保持原有16盏；材质同时生效灯数量独立允许调整到24。
    var PLUGIN_LIGHT_LIMIT = 24;
    // 改灯码仅用于轻量分享当前灯光列表，最多12盏。与用户预设保存上限分开。
    var LIGHT_CODE_MAX = 12;
    var maxSimultaneousLights = MAX_LIGHTS_DEFAULT;
    var maxLightsSlider = null;

    // V2 全局灯光控制：不改动原有灯光预设逻辑，只在其外围增加控制层。
    var globalLightEnabled = true;
    var globalMeshVisible = true;
    var globalIntensityMultiplier = 1.0;
    var pbrCompensationEnabled = true;
    var PBR_DIRECT_INTENSITY = 2.0;
    var USER_PRESET_MAX = 12;
    var USER_PRESET_LIGHT_MAX = 16;
    var userLightPresets = [];
    var userPresetDropdown = null;
    var userPresetDropdownHost = null;
    var userPresetDesc = null;

    // V2.1 作用对象系统：全局规则 + 单灯锁定。
    var LIGHT_SCOPE_FREE = 'free';
    var LIGHT_SCOPE_GLOBAL = 'global';
    var LIGHT_SCOPE_MODEL = 'model';
    var lightScopeMode = LIGHT_SCOPE_FREE;
    var lightScopeTargetModelId = '';
    var autoGlobalLightCount = 2;
    var autoGlobalLightSlider = null;
    var scopeModeSelect = null;
    var scopeTargetHost = null;
    var scopeTargetDropdown = null;

    // 阴影（ShadowGenerator）常量与默认配置
    var SHADOW_MAP_SIZES = [
        { value: 512, label: '512' },
        { value: 1024, label: '1024 (推荐)' },
        { value: 2048, label: '2048' },
        { value: 4096, label: '4096' }
    ];
    var SHADOW_MAP_SIZE_DEFAULT = 1024;

    // 灯光类型定义
    var LIGHT_TYPES = [
        { value: 'hemispheric', label: '环境光 (Hemispheric)' },
        { value: 'directional', label: '方向光 (Directional)' },
        { value: 'point', label: '点光源 (Point)' },
        { value: 'spot', label: '聚光灯 (Spot)' }
    ];

    // 灯光组合预设：仅使用聚光灯，不再使用方向光。
    // 位置按“前左上 / 前右上 / 正后方 / 后左上 / 后右上”等 45° 空间方向设计。
    // 每个预设的所有灯光 intensity 总和均 <= 0.75，优先保证阴影层次与画面稳定性。
    var LIGHT_PRESETS = [
        {
            value: 'front_dual_45',
            label: '前方45°双侧',
            description: '前左上 + 前右上双聚光，人物正面立体感均衡；总亮度 0.70。',
            lights: [
                { type: 'spot', pos: [-35, 60, 35], color: {r:1,g:1,b:1}, intensity: 0.35, angle: 34, target: [0, 8, 0], shadow: true },
                { type: 'spot', pos: [ 35, 60, 35], color: {r:1,g:1,b:1}, intensity: 0.35, angle: 34, target: [0, 8, 0], shadow: true }
            ]
        },
        {
            value: 'front_three_45',
            label: '前方45°三灯',
            description: '前左、前右 + 正前高位补光，阴影更均匀；总亮度 0.75。',
            lights: [
                { type: 'spot', pos: [-38, 65, 38], color: {r:1,g:1,b:1}, intensity: 0.25, angle: 32, target: [0, 8, 0], shadow: true },
                { type: 'spot', pos: [ 38, 65, 38], color: {r:1,g:1,b:1}, intensity: 0.25, angle: 32, target: [0, 8, 0], shadow: true },
                { type: 'spot', pos: [  0, 58, 48], color: {r:1,g:1,b:1}, intensity: 0.25, angle: 38, target: [0, 8, 0], shadow: true }
            ]
        },
        {
            value: 'rear_rim_single',
            label: '正后方轮廓光',
            description: '正后方高位单聚光，突出头发、肩部与服装轮廓；总亮度 0.70。',
            lights: [
                { type: 'spot', pos: [0, 65, -45], color: {r:1,g:1,b:1}, intensity: 0.70, angle: 30, target: [0, 10, 0], shadow: true }
            ]
        },
        {
            value: 'rear_dual_45',
            label: '后方45°双侧',
            description: '后左上 + 后右上双轮廓光，适合舞蹈与背光镜头；总亮度 0.70。',
            lights: [
                { type: 'spot', pos: [-40, 62, -38], color: {r:1,g:1,b:1}, intensity: 0.35, angle: 32, target: [0, 9, 0], shadow: true },
                { type: 'spot', pos: [ 40, 62, -38], color: {r:1,g:1,b:1}, intensity: 0.35, angle: 32, target: [0, 9, 0], shadow: true }
            ]
        },
        {
            value: 'diagonal_four_high',
            label: '四角高位交叉',
            description: '四个45°方向高位交叉布光，形成完整空间层次；总亮度 0.72。',
            lights: [
                { type: 'spot', pos: [-42, 68, 42], color: {r:1,g:1,b:1}, intensity: 0.18, angle: 34, target: [0, 8, 0], shadow: true },
                { type: 'spot', pos: [ 42, 68, 42], color: {r:1,g:1,b:1}, intensity: 0.18, angle: 34, target: [0, 8, 0], shadow: true },
                { type: 'spot', pos: [-42, 56, -42], color: {r:1,g:1,b:1}, intensity: 0.18, angle: 34, target: [0, 8, 0], shadow: true },
                { type: 'spot', pos: [ 42, 56, -42], color: {r:1,g:1,b:1}, intensity: 0.18, angle: 34, target: [0, 8, 0], shadow: true }
            ]
        },
        {
            value: 'high_low_cross',
            label: '高低错落交叉',
            description: '前左/前右高位 + 后方低位轮廓，制造明显的纵深感；总亮度 0.75。',
            lights: [
                { type: 'spot', pos: [-38, 68, 38], color: {r:1,g:1,b:1}, intensity: 0.28, angle: 32, target: [0, 8, 0], shadow: true },
                { type: 'spot', pos: [ 38, 68, 38], color: {r:1,g:1,b:1}, intensity: 0.28, angle: 32, target: [0, 8, 0], shadow: true },
                { type: 'spot', pos: [  0, 28, -42], color: {r:1,g:1,b:1}, intensity: 0.19, angle: 42, target: [0, 7, 0], shadow: true }
            ]
        },
        {
            value: 'low_side_cinematic',
            label: '低位电影侧光',
            description: '前左低位 + 后右低位形成斜向光路，适合剧情、近景和强明暗镜头；总亮度 0.70。',
            lights: [
                { type: 'spot', pos: [-30, 24, 34], color: {r:1,g:0.86,b:0.72}, intensity: 0.35, angle: 38, target: [0, 8, 0], shadow: true },
                { type: 'spot', pos: [ 34, 22, -34], color: {r:0.72,g:0.84,b:1}, intensity: 0.35, angle: 38, target: [0, 9, 0], shadow: true }
            ]
        }
    ];

    // 彩色氛围灯预设：作为基础白光布光之上的第二层色彩光场。
    // 仅使用聚光灯；每组总强度 <= 1.0，位置遵循前左/前右/正后/后左/后右等45°空间方向。
    var ATMOSPHERE_PRESETS = [
        {
            value: 'blue_purple_stage', label: '蓝紫舞台',
            description: '前方弱蓝 + 后左蓝紫 + 后右紫，强化轮廓与舞台纵深；总亮度 0.78。',
            lights: [
                { type:'spot', pos:[-34,62,34], color:{r:0.18,g:0.32,b:1.0}, intensity:0.18, angle:36, target:[0,8,0], shadow:false },
                { type:'spot', pos:[-42,64,-38], color:{r:0.22,g:0.08,b:1.0}, intensity:0.30, angle:34, target:[0,9,0], shadow:false },
                { type:'spot', pos:[42,58,-40], color:{r:0.68,g:0.10,b:1.0}, intensity:0.30, angle:34, target:[0,9,0], shadow:false }
            ]
        },
        {
            value: 'cyan_orange_cinema', label: '青橙电影',
            description: '前左暖橙、后右高位青蓝，形成暖主体与冷轮廓的电影式色彩分离；总亮度 0.70。',
            lights: [
                { type:'spot', pos:[-38,60,38], color:{r:1.0,g:0.28,b:0.05}, intensity:0.28, angle:36, target:[0,8,0], shadow:false },
                { type:'spot', pos:[38,66,-38], color:{r:0.02,g:0.78,b:1.0}, intensity:0.32, angle:34, target:[0,9,0], shadow:false },
                { type:'spot', pos:[0,52,-48], color:{r:0.03,g:0.42,b:1.0}, intensity:0.10, angle:30, target:[0,10,0], shadow:false }
            ]
        },
        {
            value: 'red_blue_stage', label: '红蓝舞台',
            description: '后左红、后右蓝，形成强烈双色轮廓；前方仅用极低强度蓝光补空间；总亮度 0.75。',
            lights: [
                { type:'spot', pos:[-42,64,-38], color:{r:1.0,g:0.03,b:0.05}, intensity:0.34, angle:32, target:[0,9,0], shadow:false },
                { type:'spot', pos:[42,64,-38], color:{r:0.03,g:0.18,b:1.0}, intensity:0.34, angle:32, target:[0,9,0], shadow:false },
                { type:'spot', pos:[0,50,44], color:{r:0.10,g:0.35,b:1.0}, intensity:0.07, angle:40, target:[0,8,0], shadow:false }
            ]
        },
        {
            value: 'pink_violet_dream', label: '紫粉梦幻',
            description: '后左紫、后右高饱和粉紫，配合前方极弱粉光，适合梦幻、二次元与柔和舞台；总亮度 0.68。',
            lights: [
                { type:'spot', pos:[-40,62,-40], color:{r:0.48,g:0.04,b:1.0}, intensity:0.30, angle:35, target:[0,9,0], shadow:false },
                { type:'spot', pos:[40,58,-38], color:{r:1.0,g:0.08,b:0.55}, intensity:0.30, angle:35, target:[0,9,0], shadow:false },
                { type:'spot', pos:[-34,46,34], color:{r:1.0,g:0.16,b:0.65}, intensity:0.08, angle:38, target:[0,8,0], shadow:false }
            ]
        },
        {
            value: 'cyan_green_night', label: '青绿夜景',
            description: '后方青绿环境色 + 右后蓝色轮廓 + 低位青光，模拟夜景环境反射；总亮度 0.72。',
            lights: [
                { type:'spot', pos:[0,68,-46], color:{r:0.02,g:1.0,b:0.72}, intensity:0.34, angle:34, target:[0,10,0], shadow:false },
                { type:'spot', pos:[42,56,-38], color:{r:0.02,g:0.35,b:1.0}, intensity:0.28, angle:35, target:[0,9,0], shadow:false },
                { type:'spot', pos:[-32,24,36], color:{r:0.03,g:0.75,b:0.72}, intensity:0.10, angle:42, target:[0,7,0], shadow:false }
            ]
        },
        {
            value: 'warm_gold', label: '暖金氛围',
            description: '前左暖金 + 后右橙红 + 正后低强度暖光，模拟舞台暖色实景灯；总亮度 0.70。',
            lights: [
                { type:'spot', pos:[-36,58,38], color:{r:1.0,g:0.48,b:0.08}, intensity:0.30, angle:36, target:[0,8,0], shadow:false },
                { type:'spot', pos:[38,62,-38], color:{r:1.0,g:0.12,b:0.03}, intensity:0.28, angle:34, target:[0,9,0], shadow:false },
                { type:'spot', pos:[0,48,-44], color:{r:1.0,g:0.62,b:0.18}, intensity:0.12, angle:40, target:[0,8,0], shadow:false }
            ]
        },
        {
            value: 'low_color_cross', label: '低位双色交叉',
            description: '低位前左紫红 + 低位后右青蓝，高位正后弱蓝，制造明显的色彩交叉与纵深；总亮度 0.64。',
            lights: [
                { type:'spot', pos:[-30,22,36], color:{r:1.0,g:0.05,b:0.38}, intensity:0.24, angle:42, target:[0,8,0], shadow:false },
                { type:'spot', pos:[34,24,-36], color:{r:0.02,g:0.72,b:1.0}, intensity:0.24, angle:42, target:[0,8,0], shadow:false },
                { type:'spot', pos:[0,64,-46], color:{r:0.08,g:0.20,b:1.0}, intensity:0.16, angle:34, target:[0,10,0], shadow:false }
            ]
        }
    ];

    // 快速选色：公共颜色表，所有灯光类型共用。
    var QUICK_COLOR_HUES = [
        { name:'红', h:0 }, { name:'橙', h:30 }, { name:'黄', h:60 },
        { name:'绿', h:120 }, { name:'青', h:180 }, { name:'蓝', h:220 }, { name:'紫', h:275 }
    ];
    var QUICK_COLOR_LEVELS = [
        { name:'淡', s:0.28, l:0.78 },
        { name:'柔', s:0.52, l:0.68 },
        { name:'中', s:0.76, l:0.58 },
        { name:'鲜', s:0.94, l:0.50 },
        { name:'浓', s:1.00, l:0.40 }
    ];

    /**
     * 创建面板
     * @param {Object} context - 插件上下文
     * @returns {HTMLElement} 面板元素
     */
export function createPanel(context) {
        if (panelInitialized && container) return container;

        scene = context.scene;
        pluginContext = context;
        panelInitialized = true;
        materialCacheDirty = true;
        shadowCasterCacheDirty = true;

        container = document.createElement('div');
        container.style.cssText = 'color:var(--text-primary);display:flex;flex-direction:column;height:100%;box-sizing:border-box;overflow:hidden;';

        // 顶部标题：灯光管理器 V3
        var header = document.createElement('div');
        header.style.cssText = 'display:flex;align-items:center;gap:8px;font-size:16px;font-weight:700;color:var(--text-primary);padding:10px 12px 6px;';
        header.textContent = '灯光管理器';
        var verBadge = document.createElement('span');
        verBadge.textContent = 'V3.2.1';
        verBadge.style.cssText = 'font-size:10px;font-weight:700;background:var(--color-primary,#3b82f6);color:#fff;border-radius:8px;padding:2px 7px;';
        header.appendChild(verBadge);
        container.appendChild(header);

        // 第二行：页面切换（光源设置 | 光动画设置）
        var switcher = document.createElement('div');
        switcher.style.cssText = 'display:grid;grid-template-columns:1fr 1fr;gap:6px;padding:0 12px 8px;border-bottom:1px solid var(--color-border);';
        var btnLightPage = document.createElement('button');
        btnLightPage.type = 'button'; btnLightPage.className = 'mp-btn primary small';
        btnLightPage.textContent = '◀ 光源设置';
        btnLightPage.style.cssText = 'min-height:36px;font-size:12px;font-weight:700;';
        var btnAnimPage = document.createElement('button');
        btnAnimPage.type = 'button'; btnAnimPage.className = 'mp-btn small';
        btnAnimPage.textContent = '光动画设置 ▶';
        btnAnimPage.style.cssText = 'min-height:36px;font-size:12px;font-weight:700;';
        switcher.appendChild(btnLightPage);
        switcher.appendChild(btnAnimPage);
        container.appendChild(switcher);

        // 两个页面容器
        var pageLight = document.createElement('div');
        pageLight.style.cssText = 'flex:1;min-height:0;overflow-y:auto;padding:12px;box-sizing:border-box;display:flex;flex-direction:column;gap:10px;';
        var pageAnim = document.createElement('div');
        pageAnim.style.cssText = 'flex:1;min-height:0;overflow-y:auto;padding:12px;box-sizing:border-box;display:none;flex-direction:column;gap:10px;';
        pageLightEl = pageLight;
        pageAnimEl = pageAnim;
        container.appendChild(pageLight);
        container.appendChild(pageAnim);

        function switchPage(toAnim) {
            var anim = !!toAnim;
            pageLightElDisplay = anim ? 'none' : 'flex';
            pageAnimElDisplay = anim ? 'flex' : 'none';
            pageLight.style.display = pageLightElDisplay;
            pageAnim.style.display = pageAnimElDisplay;
            btnLightPage.classList.toggle('primary', !anim);
            btnAnimPage.classList.toggle('primary', anim);
            btnLightPage.style.opacity = anim ? '0.45' : '1';
            btnAnimPage.style.opacity = anim ? '1' : '0.45';
            if (anim) {
                refreshAnimLightList();
                refreshGroupsUI();
                refreshAnimTargetDropdown();
            }
        }
        btnLightPage.addEventListener('click', function () { switchPage(false); });
        btnAnimPage.addEventListener('click', function () { switchPage(true); });

        pageLight.appendChild(createSettingsSection());
        pageLight.appendChild(createPresetSection());
        pageLight.appendChild(createLightListSection());
        buildAnimationPage(pageAnim);

        initGizmoManager();

        // V3：注册统一光动画帧循环（内部按呼吸/交替/追踪三组隔离）
        try {
            animFrameObserver = scene.onBeforeRenderObservable.add(animTick);
        } catch (e) {
            console.warn('[LightManagerV3] 动画帧循环注册失败:', e);
        }

        try {
            var unsub = context.eventBus.on('scene:reset', function() {
                clearAllLights();
                materialCache = [];
                materialCacheDirty = true;
                shadowCasterCache = [];
                shadowCasterCacheDirty = true;
                shadowReceiverConfigured = false;
                shadowReceiverCacheStamp = 0;
        shadowCasterCacheVersion = 0;
                applyLightScopeMode();
            });
            unsubscribers.push(unsub);
        } catch (e) {}

        try {
            var unsubModel = context.eventBus.on('model:loaded', function() {
                materialCacheDirty = true;
                shadowCasterCacheDirty = true;
                shadowReceiverConfigured = false;
                shadowReceiverCacheStamp = 0;
                shadowCasterCacheVersion = 0;
                applyMaxSimultaneousLights(maxSimultaneousLights);
                applyPBRCompensation();
                refreshAllShadowCasters();
                refreshScopeTargetDropdown();
                applyLightScopeMode();
            });
            unsubscribers.push(unsubModel);
        } catch (e) {}

        try {
            var unsubRemoved = context.eventBus.on('model:removed', function() {
                materialCacheDirty = true;
                shadowCasterCacheDirty = true;
                shadowReceiverConfigured = false;
                shadowReceiverCacheStamp = 0;
                refreshScopeTargetDropdown();
                applyLightScopeMode();
                cleanupTrackModelRefs();
            });
            unsubscribers.push(unsubRemoved);
        } catch (e) {}

        try {
            if (mp.model && typeof mp.model.onChanged === 'function') {
                var unsubChanged = mp.model.onChanged(function() {
                    materialCacheDirty = true;
                    shadowCasterCacheDirty = true;
                    shadowReceiverConfigured = false;
                    shadowReceiverCacheStamp = 0;
                    shadowCasterCacheVersion = 0;
                    setTimeout(function() {
                        if (!panelInitialized) return;
                        refreshScopeTargetDropdown();
                        applyLightScopeMode();
                    }, 0);
                });
                if (typeof unsubChanged === 'function') unsubscribers.push(unsubChanged);
            }
        } catch (e) {}

        // 持久化设置：读取完成后只做一次必要的全局刷新。
        context.storage.get('maxSimultaneousLights').then(function(saved) {
            if (typeof saved === 'number' && saved >= MAX_LIGHTS_MIN && saved <= MAX_LIGHTS_MAX) {
                maxSimultaneousLights = Math.min(PLUGIN_LIGHT_LIMIT, Math.max(MAX_LIGHTS_MIN, Math.floor(saved)));
                if (maxLightsSlider) { try { maxLightsSlider.setValue(saved); } catch (e) {} }
            }
            return context.storage.get('globalLightEnabled');
        }).then(function(savedEnabled) {
            if (typeof savedEnabled === 'boolean') globalLightEnabled = savedEnabled;
            return context.storage.get('globalMeshVisible');
        }).then(function(savedMeshVisible) {
            if (typeof savedMeshVisible === 'boolean') globalMeshVisible = savedMeshVisible;
            return context.storage.get('globalIntensityMultiplier');
        }).then(function(savedMult) {
            if (typeof savedMult === 'number' && savedMult >= 0 && savedMult <= 3) globalIntensityMultiplier = savedMult;
            return context.storage.get('pbrCompensationEnabled');
        }).then(function(savedPbr) {
            if (typeof savedPbr === 'boolean') pbrCompensationEnabled = savedPbr;
            return context.storage.get('userLightPresets');
        }).then(function(savedPresets) {
            if (Array.isArray(savedPresets)) {
                var validPresets = savedPresets.filter(function(p) { return p && Array.isArray(p.lights) && p.lights.length <= USER_PRESET_LIGHT_MAX; });
                userLightPresets = validPresets.slice(-USER_PRESET_MAX);
                if (validPresets.length !== savedPresets.length || userLightPresets.length !== savedPresets.length) context.storage.set('userLightPresets', userLightPresets);
            }
            return context.storage.get('autoGlobalLightCount');
        }).then(function(savedAutoCount) {
            if (typeof savedAutoCount === 'number' && savedAutoCount >= 0 && savedAutoCount <= PLUGIN_LIGHT_LIMIT) autoGlobalLightCount = Math.floor(savedAutoCount);
            if (autoGlobalLightSlider) { try { autoGlobalLightSlider.setValue(autoGlobalLightCount); } catch (e) {} }
            return context.storage.get('lightScopeMode');
        }).then(function(savedScope) {
            if (savedScope === LIGHT_SCOPE_GLOBAL || savedScope === LIGHT_SCOPE_MODEL || savedScope === LIGHT_SCOPE_FREE) lightScopeMode = savedScope;
            return context.storage.get('lightScopeTargetModelId');
        }).then(function(savedTarget) {
            if (savedTarget != null) lightScopeTargetModelId = String(savedTarget);
            refreshUserPresetDropdown();
            refreshScopeTargetDropdown();
            syncScopeModeUI();
            applyGlobalIntensityMultiplier();
            applyGlobalLightEnabled();
            applyGlobalMeshVisible();
            applyMaxSimultaneousLights(maxSimultaneousLights);
            applyPBRCompensation();
            applyLightScopeMode();
        }).then(function () {
            return context.storage.get('animGlobalEnabled');
        }).then(function (savedAnim) {
            if (typeof savedAnim === 'boolean') {
                animGlobalEnabled = savedAnim;
                if (globalAnimToggle && typeof globalAnimToggle.setValue === 'function') {
                    try { globalAnimToggle.setValue(animGlobalEnabled); } catch (e) {}
                }
            }
        }).catch(function(e) {
            console.warn('[LightManager] 设置读取失败:', e);
            refreshScopeTargetDropdown();
            syncScopeModeUI();
            applyGlobalIntensityMultiplier();
            applyGlobalLightEnabled();
            applyMaxSimultaneousLights(maxSimultaneousLights);
            applyPBRCompensation();
            applyLightScopeMode();
        });

        return container;
    };

    /**
     * 创建"灯光生效设置"区域
     */
    function makeCollapsibleSection(titleText, className) {
        var section = document.createElement('section');
        section.className = className || 'lm-section';
        section.style.cssText = 'background:var(--color-surface);border-radius:var(--radius-md);border:1px solid var(--color-border);overflow:hidden;';
        var head = document.createElement('button');
        head.type = 'button';
        head.className = 'mp-btn';
        head.style.cssText = 'width:100%;border:0;border-radius:0;background:transparent;text-align:left;padding:10px 12px;min-height:40px;font-size:14px;font-weight:700;color:var(--text-primary);display:flex;justify-content:space-between;align-items:center;';
        var text = document.createElement('span'); text.textContent = titleText;
        var arrow = document.createElement('span'); arrow.textContent = '▼'; arrow.style.cssText='font-size:11px;color:var(--text-secondary);';
        head.appendChild(text); head.appendChild(arrow); section.appendChild(head);
        var body = document.createElement('div');
        body.style.cssText = 'padding:0 12px 12px;';
        section.appendChild(body);
        head.addEventListener('click', function(){
            var open = body.style.display !== 'none';
            body.style.display = open ? 'none' : 'block';
            arrow.textContent = open ? '▶' : '▼';
        });
        section.body = body;
        return section;
    }

    function createSettingsSection() {
        var section = makeCollapsibleSection('全局控制', 'v2-global-section');
        var body = section.body;

        var scopeTitle = document.createElement('div');
        scopeTitle.textContent = '灯光作用对象';
        scopeTitle.style.cssText='font-size:12px;font-weight:700;color:var(--text-secondary);margin:2px 0 7px;';
        body.appendChild(scopeTitle);

        // V3.2.1：自由模式与全局轮廓光并列，自动模式保留独立行。
        var scopeStack=document.createElement('div');
        scopeStack.style.cssText='display:flex;flex-direction:column;gap:6px;margin-bottom:8px;';
        var scopeTopRow=document.createElement('div');
        scopeTopRow.style.cssText='display:grid;grid-template-columns:1fr 1fr;gap:6px;';

        function makeScopeButton(value,text){
            var b=document.createElement('button');
            b.type='button'; b.className='mp-btn small'; b.textContent=text;
            b.style.cssText='width:100%;min-height:38px;padding:5px 9px;font-size:12px;font-weight:600;text-align:left;';
            b.addEventListener('click',function(){setLightScopeMode(value);});
            if(!scopeModeSelect) scopeModeSelect={};
            scopeModeSelect[value]=b;
            return b;
        }

        scopeTopRow.appendChild(makeScopeButton(LIGHT_SCOPE_FREE,'自由模式'));
        scopeTopRow.appendChild(makeScopeButton(LIGHT_SCOPE_GLOBAL,'全局轮廓光'));
        scopeStack.appendChild(scopeTopRow);

        var autoRow=document.createElement('div');
        autoRow.style.cssText='display:grid;grid-template-columns:minmax(0,1fr) minmax(150px,2fr);gap:8px;align-items:center;';
        autoRow.appendChild(makeScopeButton(LIGHT_SCOPE_MODEL,'自动模式'));
        autoGlobalLightSlider=new Slider({label:'全局灯',min:0,max:PLUGIN_LIGHT_LIMIT,step:1,value:autoGlobalLightCount,showValue:true});
        autoGlobalLightSlider.element.style.cssText += ';min-width:0;';
        autoGlobalLightSlider.onChange(function(value){
            autoGlobalLightCount=Math.max(0,Math.min(PLUGIN_LIGHT_LIMIT,Math.floor(Number(value)||0)));
            if(pluginContext) pluginContext.storage.set('autoGlobalLightCount',autoGlobalLightCount);
            if(lightScopeMode===LIGHT_SCOPE_MODEL) applyLightScopeMode();
        });
        autoRow.appendChild(autoGlobalLightSlider.element);
        scopeStack.appendChild(autoRow);
        body.appendChild(scopeStack);

        var targetWrap=document.createElement('div');
        targetWrap.style.cssText='margin-bottom:8px;';
        var targetLabel=document.createElement('div'); targetLabel.textContent='目标模型'; targetLabel.style.cssText='font-size:11px;color:var(--text-secondary);margin-bottom:5px;'; targetWrap.appendChild(targetLabel);
        scopeTargetHost=document.createElement('div'); targetWrap.appendChild(scopeTargetHost); body.appendChild(targetWrap);
        scopeTargetWrap=targetWrap;

        // 三个全局开关并列一行，手机窄屏时缩小文字，避免换行。
        var masterRow=document.createElement('div');
        masterRow.style.cssText='display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:5px;align-items:stretch;margin-bottom:7px;';
        function compactToggle(toggle){
            try { toggle.element.style.minWidth='0'; toggle.element.style.width='100%'; }
            catch(e) {}
            var labels=toggle.element.querySelectorAll ? toggle.element.querySelectorAll('span,div,label') : [];
            for(var i=0;i<labels.length;i++){ labels[i].style.fontSize='10px'; labels[i].style.whiteSpace='nowrap'; }
            return toggle.element;
        }
        var master = new mp.ui.ToggleSwitch({ label:'灯光开关', initialState:globalLightEnabled });
        master.onChange(function(enabled){ globalLightEnabled=!!enabled; applyGlobalLightEnabled(); if(pluginContext) pluginContext.storage.set('globalLightEnabled',globalLightEnabled); });
        masterRow.appendChild(compactToggle(master));

        var meshMaster = new mp.ui.ToggleSwitch({ label:'隐藏网格', initialState:!globalMeshVisible });
        meshMaster.onChange(function(hidden){ globalMeshVisible=!hidden; applyGlobalMeshVisible(); if(pluginContext) pluginContext.storage.set('globalMeshVisible',globalMeshVisible); });
        masterRow.appendChild(compactToggle(meshMaster));

        var pbr = new mp.ui.ToggleSwitch({label:'PBR补偿',initialState:pbrCompensationEnabled});
        pbr.onChange(function(enabled){pbrCompensationEnabled=!!enabled;applyPBRCompensation();if(pluginContext)pluginContext.storage.set('pbrCompensationEnabled',pbrCompensationEnabled);});
        masterRow.appendChild(compactToggle(pbr));
        body.appendChild(masterRow);

        // 全局倍率与同时生效灯数量各占一行，不再显示额外说明。
        var mult = new Slider({label:'全局灯光强度倍率',min:0,max:3,step:0.01,value:globalIntensityMultiplier,showValue:true});
        mult.onChange(function(value){globalIntensityMultiplier=Math.max(0,Number(value)||0);applyGlobalIntensityMultiplier();if(pluginContext)pluginContext.storage.set('globalIntensityMultiplier',globalIntensityMultiplier);});
        body.appendChild(mult.element);

        var slider=new Slider({label:'最多同时生效灯数量',min:MAX_LIGHTS_MIN,max:MAX_LIGHTS_MAX,step:1,value:maxSimultaneousLights,showValue:true});
        var maxLightsWarning=document.createElement('div');
        maxLightsWarning.textContent='⚠ 同时生效灯数量超过10，请根据手机实际性能调整最大生效灯数量。';
        maxLightsWarning.style.cssText='display:'+(maxSimultaneousLights>10?'block':'none')+';font-size:10px;color:var(--color-warning,#d98b00);line-height:1.4;margin:3px 0 0;';
        slider.onChange(function(value){
            maxSimultaneousLights=Math.max(MAX_LIGHTS_MIN,Math.min(MAX_LIGHTS_MAX,Math.floor(Number(value)||MAX_LIGHTS_DEFAULT)));
            applyMaxSimultaneousLights(maxSimultaneousLights);
            if(pluginContext)pluginContext.storage.set('maxSimultaneousLights',maxSimultaneousLights);
            maxLightsWarning.style.display=maxSimultaneousLights>10?'block':'none';
            if(maxSimultaneousLights>10) toast.info('警告：同时生效灯数量已超过10，请根据手机实际性能调整最大生效灯数量。',3200);
        });
        body.appendChild(slider.element); maxLightsSlider=slider;
        body.appendChild(maxLightsWarning);

        return section;
    }

    var scopeTargetWrap = null;

    function getModelsForScope(){
        try { return (mp.model && typeof mp.model.list==='function' ? mp.model.list() : []) || []; } catch(e){ return []; }
    }

    function refreshScopeTargetDropdown(){
        if(!scopeTargetHost) return;
        var models=getModelsForScope().filter(function(m){return m && m.mesh;});
        var options=models.map(function(m){return {value:String(m.id),label:m.name||String(m.id)};});
        if(!options.length) options=[{value:'',label:'— 场景中暂无可用模型 —'}];
        scopeTargetHost.innerHTML='';
        var keep=lightScopeTargetModelId && options.some(function(o){return o.value===lightScopeTargetModelId;}) ? lightScopeTargetModelId : options[0].value;
        if(keep) lightScopeTargetModelId=keep;
        scopeTargetDropdown=new Dropdown({options:options,selectedValue:keep,placeholder:'选择目标模型'});
        scopeTargetDropdown.onChange(function(v){lightScopeTargetModelId=String(v||'');if(pluginContext)pluginContext.storage.set('lightScopeTargetModelId',lightScopeTargetModelId);if(lightScopeMode===LIGHT_SCOPE_GLOBAL)applyLightScopeMode();});
        scopeTargetHost.appendChild(scopeTargetDropdown.element);
        if(pluginContext)pluginContext.storage.set('lightScopeTargetModelId',lightScopeTargetModelId);
        syncScopeModeUI();
    }

    function syncScopeModeUI(){
        if(scopeModeSelect){
            Object.keys(scopeModeSelect).forEach(function(k){
                var b=scopeModeSelect[k]; if(!b)return;
                var active=k===lightScopeMode;
                b.classList.toggle('primary',active);
                b.style.opacity=active?'1':'0.42';
                b.style.filter=active?'none':'saturate(0.55)';
            });
        }
        if(scopeTargetWrap) scopeTargetWrap.style.display=lightScopeMode===LIGHT_SCOPE_GLOBAL?'block':'none';
    }

    function setLightScopeMode(mode){
        if(mode!==LIGHT_SCOPE_FREE && mode!==LIGHT_SCOPE_GLOBAL && mode!==LIGHT_SCOPE_MODEL) return;
        if(mode===LIGHT_SCOPE_GLOBAL && !lightScopeTargetModelId){toast.info('全局轮廓光需要先指定目标模型。',2000);return;}
        lightScopeMode=mode;
        syncScopeModeUI();
        if(pluginContext)pluginContext.storage.set('lightScopeMode',lightScopeMode);
        applyLightScopeMode();
    }

    function isScopeManagedLight(info){ return !!info && (info.type==='point'||info.type==='spot') && !info.locked; }

    function collectModelMeshes(model){
        var out=[],seen={};
        function add(mesh){
            if(!mesh||mesh.lightRef)return;
            var key=mesh.uniqueId!=null?String(mesh.uniqueId):null;
            if(key!==null){if(seen[key])return;seen[key]=true;}else if(out.indexOf(mesh)!==-1)return;
            out.push(mesh);
        }
        function walk(root){
            if(!root)return;
            add(root);
            try{if(typeof root.getChildMeshes==='function')root.getChildMeshes(true).forEach(add);}catch(e){}
        }
        if(Array.isArray(model)) model.forEach(walk); else walk(model && model.mesh ? model.mesh : model);
        return out;
    }

    function getTargetModelMeshes(){
        var models=getModelsForScope();
        for(var i=0;i<models.length;i++) if(String(models[i].id)===String(lightScopeTargetModelId)) return collectModelMeshes(models[i]);
        return [];
    }

    function setLightScope(info, scope, targetMeshes){
        if(!info||!info.light||(info.type!=='point'&&info.type!=='spot'))return;
        try{
            if(scope===LIGHT_SCOPE_MODEL){
                info.light.includedOnlyMeshes=(targetMeshes||[]).slice();
                info.light.__mikuplayScope=LIGHT_SCOPE_MODEL;
                info.scope=LIGHT_SCOPE_MODEL;
            }else{
                info.light.includedOnlyMeshes=[];
                info.light.__mikuplayScope=LIGHT_SCOPE_GLOBAL;
                info.scope=LIGHT_SCOPE_GLOBAL;
            }
        }catch(e){console.warn('[LightManager] 设置灯光作用对象失败:',e);}
    }

    function getAutoTargetModelMeshes(){
        var models=getModelsForScope().filter(function(m){return m&&m.mesh;});
        if(!models.length)return [];
        if(lightScopeTargetModelId){
            for(var i=0;i<models.length;i++) if(String(models[i].id)===String(lightScopeTargetModelId)) return collectModelMeshes(models[i]);
        }
        // 自动模式没有额外弹出选择器：优先使用已保存目标，否则使用模型列表第一项。
        return collectModelMeshes(models[0]);
    }

    function applyLightScopeMode(){
        if(lightScopeMode===LIGHT_SCOPE_FREE)return;
        var targetMeshes=lightScopeMode===LIGHT_SCOPE_GLOBAL?getTargetModelMeshes():getAutoTargetModelMeshes();
        if(!targetMeshes.length)return;
        var eligible=[];
        lights.forEach(function(info){if(isScopeManagedLight(info))eligible.push(info);});
        if(lightScopeMode===LIGHT_SCOPE_GLOBAL){
            eligible.forEach(function(info){setLightScope(info,LIGHT_SCOPE_MODEL,targetMeshes);});
        }else if(lightScopeMode===LIGHT_SCOPE_MODEL){
            eligible.forEach(function(info,index){setLightScope(info,index<autoGlobalLightCount?LIGHT_SCOPE_GLOBAL:LIGHT_SCOPE_MODEL,targetMeshes);});
        }
    }

    function applyGlobalIntensityMultiplier() {
        lights.forEach(function(info) {
            if (info && info.light) info.light.intensity = (Number(info.intensity) || 0) * globalIntensityMultiplier;
        });
    }

    function applyGlobalLightEnabled() {
        lights.forEach(function(info) {
            if (!info || !info.light) return;
            info.light.setEnabled(!!info.enabled && globalLightEnabled);
            if (info.mesh) info.mesh.setEnabled(!!info.enabled && !!info.meshVisible && globalMeshVisible);
        });
    }

    function applyGlobalMeshVisible() {
        lights.forEach(function(info) {
            if (!info || !info.mesh) return;
            info.mesh.setEnabled(!!info.enabled && !!info.meshVisible && globalMeshVisible);
        });
    }

    function isPBRMaterial(mat) {
        if (!mat) return false;
        var cls = '';
        try { if (typeof mat.getClassName === 'function') cls = mat.getClassName() || ''; } catch (e) {}
        if (typeof mat.directIntensity === 'number') {
            return /PBR|PBRMetallic|PBRMaterial|PBRBase/i.test(cls) || mat.usePhysicalLightFalloff !== undefined;
        }
        return /PBR|PBRMetallic/i.test(cls);
    }

    function rebuildMaterialCache() {
        if (!scene) return;
        var map = {};
        var list = [];

        function add(mat) {
            if (!mat) return;
            var key = mat.uniqueId != null ? String(mat.uniqueId) : null;
            if (key !== null) {
                if (map[key]) return;
                map[key] = true;
            } else if (list.indexOf(mat) !== -1) {
                return;
            }
            list.push(mat);
        }

        (scene.materials || []).forEach(add);
        (scene.meshes || []).forEach(function(mesh) {
            if (!mesh) return;
            add(mesh.material);
            if (mesh.subMeshes) mesh.subMeshes.forEach(function(sub) {
                if (sub) add(sub.material);
            });
        });

        materialCache = list;
        materialCacheDirty = false;
    }

    function ensureMaterialCache() {
        if (materialCacheDirty) rebuildMaterialCache();
        return materialCache;
    }

    function applyPBRCompensation() {
        if (!scene) return 0;
        var applied = 0;
        ensureMaterialCache().forEach(function(mat) {
            if (isPBRMaterial(mat) && typeof mat.directIntensity === 'number') {
                var target = pbrCompensationEnabled ? PBR_DIRECT_INTENSITY : 1.0;
                if (mat.directIntensity !== target) {
                    mat.directIntensity = target;
                    applied++;
                }
            }
        });
        return applied;
    }

    function getLightDirectionArray(light) {
        if (!light || !light.direction) return [0, -1, 0];
        return [Number(light.direction.x)||0, Number(light.direction.y)||-1, Number(light.direction.z)||0];
    }

    function getLightRotationArray(info) {
        if (!info || !info.mesh || !info.mesh.rotation) return [0,0,0];
        return [Number(info.mesh.rotation.x)||0, Number(info.mesh.rotation.y)||0, Number(info.mesh.rotation.z)||0];
    }

    function round3(v) { return Math.round((Number(v)||0) * 1000) / 1000; }

    function snapshotLights() {
        var arr = [];
        lights.forEach(function(info) {
            if (!info || !info.light) return;
            var p = info.light.position || {x:0,y:0,z:0};
            var c = info.color || {r:1,g:1,b:1};
            arr.push({
                name: String(info.name || '').slice(0, 8),
                type: info.type,
                position: [round3(p.x), round3(p.y), round3(p.z)],
                direction: getLightDirectionArray(info.light).map(round3),
                rotation: getLightRotationArray(info).map(round3),
                color: [round3(c.r), round3(c.g), round3(c.b)],
                intensity: round3(info.intensity),
                enabled: !!info.enabled,
                meshVisible: !!info.meshVisible,
                angle: info.type === 'spot' ? round3(degreesFromRadians(info.light.angle)) : 0,
                exponent: info.type === 'spot' ? round3(getSpotExponent(info)) : 0,
                range: (info.type === 'point' || info.type === 'spot') ? round3(getLightRange(info)) : 0,
                // 保留旧字段用于读取旧 V3 用户预设，不作为 V3.2.1 UI 数据源。
                softness: info.type === 'spot' ? round3(getSpotExponent(info)) : 0,
                area: (info.type === 'spot') ? round3(degreesFromRadians(info.light.angle)) : ((info.type === 'point') ? round3(getLightRange(info)) : 0),
                shadowEnabled: !!info.shadowEnabled,
                shadowMapSize: Number(info.shadowMapSize) || SHADOW_MAP_SIZE_DEFAULT,
                shadowBlur: !!info.shadowBlur,
                locked: !!info.locked,
                scope: info.scope || LIGHT_SCOPE_GLOBAL
            });
        });
        return arr;
    }

    function makePresetName() {
        var base = '灯光预设 ' + (userLightPresets.length + 1);
        if (!userLightPresets.some(function(p){ return p.name === base; })) return base;
        var i = 2;
        while (userLightPresets.some(function(p){ return p.name === base + ' (' + i + ')' ; })) i++;
        return base + ' (' + i + ')';
    }

    function saveUserPresets() {
        if (!pluginContext) return Promise.resolve();
        return pluginContext.storage.set('userLightPresets', userLightPresets);
    }

    function refreshUserPresetDropdown() {
        if (!userPresetDropdownHost) return;
        userPresetDropdownHost.innerHTML = '';
        var sel=document.createElement('select');
        sel.className='mp-input';
        sel.style.cssText='width:100%;min-height:36px;box-sizing:border-box;padding:6px 8px;background:var(--color-bg);color:var(--text-primary);border:1px solid var(--color-border);border-radius:var(--radius-sm);font-size:12px;';
        if(!userLightPresets.length){ var emptyOpt=document.createElement('option'); emptyOpt.value=''; emptyOpt.textContent='暂无用户偏好'; sel.appendChild(emptyOpt); }
        else userLightPresets.forEach(function(p,i){ var o=document.createElement('option'); o.value=String(i); o.textContent=p.name; sel.appendChild(o); });
        if(userLightPresets.length) sel.value=String(Math.max(0,userLightPresets.length-1));
        userPresetDropdown={getValue:function(){return sel.value;},element:sel};
        sel.addEventListener('change',function(){
            if(userPresetDesc){ var idx=parseInt(sel.value,10); var p=(idx>=0)?userLightPresets[idx]:null; userPresetDesc.textContent=p?('包含 '+p.lights.length+' 盏灯；保存于 '+(p.timeText||'本次会话')):'暂无用户偏好预设。'; }
        });
        userPresetDropdownHost.appendChild(sel);
        if (userPresetDesc) {
            var idx = userLightPresets.length ? (parseInt(userPresetDropdown.getValue(),10) || 0) : -1;
            var p = idx >= 0 ? userLightPresets[idx] : null;
            userPresetDesc.textContent = p ? ('包含 ' + p.lights.length + ' 盏灯；保存于 ' + (p.timeText || '本次会话')) : '暂无用户偏好预设。';
        }
    }

    function selectedUserPreset() {
        if (!userLightPresets.length) return null;
        var idx = 0;
        if (userPresetDropdown) {
            try { idx = parseInt(userPresetDropdown.getValue(), 10) || 0; } catch (e) {}
        }
        return userLightPresets[idx] || userLightPresets[0];
    }

    function createUserPresetSection() {
        var section = document.createElement('div');
        section.className = 'v2-user-preset-section';
        section.style.cssText = 'background: var(--color-surface); border-radius: var(--radius-md); padding: 12px; border: 1px solid var(--color-border);';

        var title = document.createElement('div');
        title.style.cssText = 'font-size: 14px; font-weight: 600; margin-bottom: 8px; color: var(--text-primary);';
        title.textContent = '用户偏好';
        section.appendChild(title);

        var tip = document.createElement('div');
        tip.style.cssText = 'font-size: 11px; color: var(--text-secondary); line-height: 1.5; margin-bottom: 10px;';
        tip.textContent = '保存当前全部灯光状态，包括位置、方向、颜色、强度、角度、显示状态和阴影设置；不会覆盖官方预设。';
        section.appendChild(tip);

        var host = document.createElement('div');
        host.className = 'v2-user-preset-dropdown-host';
        section.appendChild(host);
        userPresetDropdown = null;
        userPresetDropdownHost = host;

        var desc = document.createElement('div');
        userPresetDesc = desc;
        desc.style.cssText = 'font-size: 11px; color: var(--text-disabled); line-height: 1.5; margin: 8px 0; min-height: 18px;';
        desc.textContent = '暂无用户偏好预设。';
        section.appendChild(desc);

        var presetActionRow = document.createElement('div');
        presetActionRow.style.cssText = 'display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:2px;';

        var renameBtn = document.createElement('button');
        renameBtn.className = 'mp-btn';
        renameBtn.textContent = '重命名预设';
        renameBtn.style.cssText = 'min-height:40px;font-size:13px;font-weight:600;';
        renameBtn.addEventListener('click', renameSelectedUserPreset);
        presetActionRow.appendChild(renameBtn);

        var deleteBtn = document.createElement('button');
        deleteBtn.className = 'mp-btn danger';
        deleteBtn.textContent = '删除选中预设';
        deleteBtn.style.cssText = 'min-height:40px;font-size:13px;font-weight:600;';
        deleteBtn.addEventListener('click', deleteSelectedUserPreset);
        presetActionRow.appendChild(deleteBtn);
        section.appendChild(presetActionRow);

        refreshUserPresetDropdown();
        return section;
    }

    function renameSelectedUserPreset() {
        var preset = selectedUserPreset();
        if (!preset || !userLightPresets.length) { toast.info('当前没有可重命名的用户预设', 1800); return; }
        var oldName = String(preset.name || '灯光预设');
        var name = window.prompt('请输入新的预设名称：', oldName);
        if (name === null) return;
        name = String(name).trim();
        if (!name) { toast.info('预设名称不能为空', 1800); return; }
        if (Array.from(name).length > 12) { toast.info('预设名称最多12个字符，请重新输入。', 2200); return; }
        if (userLightPresets.some(function(p){ return p !== preset && String(p.name || '') === name; })) {
            toast.info('已存在同名用户预设，请换一个名称。', 2000); return;
        }
        preset.name = name;
        saveUserPresets().then(function(){ refreshUserPresetDropdown(); toast.success('已重命名为：' + name, 2000); }).catch(function(){
            preset.name = oldName; refreshUserPresetDropdown(); toast.error('重命名保存失败', 2000);
        });
    }

    function deleteSelectedUserPreset() {
        var preset = selectedUserPreset();
        if (!preset || !userLightPresets.length) {
            toast.info('当前没有可删除的用户预设', 1800);
            return;
        }

        var idx = userLightPresets.indexOf(preset);
        if (idx < 0) {
            toast.error('未找到要删除的用户预设', 1800);
            return;
        }

        var name = String(preset.name || ('灯光预设 ' + (idx + 1)));
        if (!window.confirm('确定删除用户预设“' + name + '”吗？\n\n删除后无法通过灯光管理器恢复。当前场景中的灯光不会受到影响。')) return;

        userLightPresets.splice(idx, 1);
        saveUserPresets().then(function() {
            refreshUserPresetDropdown();
            toast.success('已删除用户预设：' + name, 2000);
        }).catch(function() {
            // 本地存储失败时尽量恢复内存中的数据，避免界面与持久化状态不一致。
            userLightPresets.splice(idx, 0, preset);
            refreshUserPresetDropdown();
            toast.error('删除失败，用户预设未被保存修改', 2200);
        });
    }

    function saveCurrentAsUserPreset() {
        if (lights.size > USER_PRESET_LIGHT_MAX) { toast.info('灯光过多，请进行删减优化。用户预设最多保存16盏灯光。当前：' + lights.size + ' / 16', 2600); return; }
        if (lights.size === 0) { toast.info('当前灯光列表为空，无法保存预设。', 1800); return; }
        if (userLightPresets.length >= USER_PRESET_MAX) { toast.info('用户预设已达到上限（12个），请先删除一个预设。', 2200); return; }
        var name = window.prompt('请输入用户灯光预设名称：', makePresetName());
        if (name === null) return;
        name = String(name).trim() || makePresetName();
        var preset = { name:name, lights:snapshotLights(), timeText:new Date().toLocaleString() };
        userLightPresets.push(preset);
        saveUserPresets().then(function(){ refreshUserPresetDropdown(); toast.success('已保存用户预设：' + name, 2000); }).catch(function(){ toast.error('用户预设保存失败',2200); });
    }

    // -------- MMDPLAY 改灯码 V1 --------
    // 规则：当前灯光列表完整快照 -> 紧凑位打包 -> Base64URL -> MMDPLAY_..._MMDPLAY。
    // 不依赖官方预设；导入后仅保存到“用户偏好”，不会直接修改当前场景。
    function utf8Bytes(text) {
        if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(text);
        var s=unescape(encodeURIComponent(text)), a=new Uint8Array(s.length); for(var i=0;i<s.length;i++)a[i]=s.charCodeAt(i); return a;
    }
    function b64url(bytes) {
        var bin=''; for(var i=0;i<bytes.length;i++)bin+=String.fromCharCode(bytes[i]);
        return btoa(bin).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
    }
    function fromB64url(str) {
        str=str.replace(/-/g,'+').replace(/_/g,'/'); while(str.length%4)str+='=';
        var bin=atob(str), a=new Uint8Array(bin.length); for(var i=0;i<bin.length;i++)a[i]=bin.charCodeAt(i); return a;
    }
    function fnv16(bytes) { var h=2166136261; for(var i=0;i<bytes.length;i++){h^=bytes[i];h=Math.imul(h,16777619);} return (h>>>0).toString(16).slice(-4).padStart(4,'0'); }
    function typeCode(t){ return t==='hemispheric'?0:t==='directional'?1:t==='point'?2:3; }
    function codeType(n){ return ['hemispheric','directional','point','spot'][n] || 'spot'; }
    function clamp(v,min,max){return Math.max(min,Math.min(max,v));}

    // V3.2.1：UI 直接使用 Babylon 原生灯光参数，不再做 0~100 百分比映射。
    // intensity：原生强度；range：Point/Spot 原生作用距离；
    // angle：Spot 原生光锥角（内部弧度）；exponent：Spot 原生边缘衰减指数。
    function nativeNumber(v, fallback) {
        v = Number(v);
        return isFinite(v) ? v : fallback;
    }
    function degreesFromRadians(rad) { return nativeNumber(rad, Math.PI / 3) * 180 / Math.PI; }
    function radiansFromDegrees(deg) { return nativeNumber(deg, 60) * Math.PI / 180; }
    function getLightRange(info) {
        return info && info.light && typeof info.light.range === 'number' ? info.light.range : 0;
    }
    function getSpotExponent(info) {
        return info && info.light && typeof info.light.exponent === 'number' ? info.light.exponent : 2;
    }

    // 仅用于读取旧版 V3 用户预设/改灯码，V3.2.1 新数据不再依赖这些百分比映射。
    function legacyBrightnessToIntensity(v){ return clamp(v,0,100) / 10; }
    function legacySoftnessToSpotExponent(v){
        var t=clamp(v,0,100)/100;
        return 128 - (127*t);
    }
    function legacySpotAngleToArea(rad){
        var deg=degreesFromRadians(rad);
        return clamp(Math.round(deg),1,180);
    }
    function applyLightSoftness(info,v){
        if(!info||!info.light||info.type!=='spot')return;
        var e=Math.max(0,nativeNumber(v,info.light.exponent));
        info.light.exponent=e;
        info.exponent=e;
    }
    function applyLightArea(info,v){
        if(!info||!info.light)return;
        if(info.type==='spot'){
            var deg=Math.min(90,Math.max(0.001,nativeNumber(v,degreesFromRadians(info.light.angle))));
            info.light.angle=radiansFromDegrees(deg);
            info.angle=info.light.angle;
        }else if(info.type==='point'){
            var range=Math.max(0,nativeNumber(v,info.light.range));
            info.light.range=range;
            info.range=range;
        }
    }

    // 简单位流：把多个参数紧密塞入连续 bit，避免每个数都占完整 8/16/32 bit。
    function BitWriter(){this.a=[];this.cur=0;this.bits=0;}
    BitWriter.prototype.write=function(v,n){v=Math.floor(Number(v)||0); if(v<0)v=0; for(var i=n-1;i>=0;i--){this.cur=(this.cur<<1)|((v>>>i)&1);this.bits++;if(this.bits===8){this.a.push(this.cur);this.cur=0;this.bits=0;}}};
    BitWriter.prototype.finish=function(){if(this.bits){this.a.push(this.cur<<(8-this.bits));this.cur=0;this.bits=0;}return new Uint8Array(this.a);};
    function BitReader(bytes){this.a=bytes;this.i=0;this.bits=0;this.cur=0;}
    BitReader.prototype.read=function(n){var v=0;for(var k=0;k<n;k++){if(this.bits===0){if(this.i>=this.a.length)throw new Error('编码数据不完整');this.cur=this.a[this.i++];this.bits=8;}v=(v<<1)|((this.cur>>7)&1);this.cur=(this.cur<<1)&255;this.bits--;}return v;};

    function qSigned(v, min, step, bits){return clamp(Math.round(((Number(v)||0)-min)/step),0,(1<<bits)-1);}
    function dSigned(q,min,step){return q*step+min;}
    function qAngleRad(v){var pi=Math.PI, x=Number(v)||0; while(x<-pi)x+=2*pi; while(x>pi)x-=2*pi; return Math.round((x+pi)/(2*pi)*1023);}
    function dAngleRad(q){return q/1023*(2*Math.PI)-Math.PI;}

    // 方向用“方位角 + 仰角”各 8 bit 编码，稳定、直观且无需保存 3 个 float。
    function encodeDirection(x,y,z){
        x=Number(x)||0;y=Number(y)||-1;z=Number(z)||0;
        var len=Math.sqrt(x*x+y*y+z*z)||1;x/=len;y/=len;z/=len;
        var yaw=Math.atan2(z,x); // -PI ~ PI
        var elev=Math.asin(clamp(y,-1,1)); // -PI/2 ~ PI/2
        return [clamp(Math.round((yaw+Math.PI)/(2*Math.PI)*255),0,255),clamp(Math.round((elev+Math.PI/2)/Math.PI*255),0,255)];
    }
    function decodeDirection(a,b){
        var yaw=a/255*(2*Math.PI)-Math.PI, elev=b/255*Math.PI-Math.PI/2;
        var ce=Math.cos(elev);return [Math.cos(yaw)*ce,Math.sin(elev),Math.sin(yaw)*ce];
    }
    function shadowMapCode(v){return v===512?0:v===1024?1:v===2048?2:v===4096?3:1;}
    function shadowMapValue(v){return [512,1024,2048,4096][v&3]||1024;}

    function encodeCurrentLightList(){
        var ls=snapshotLights();
        if(ls.length>LIGHT_CODE_MAX)throw new Error('灯光过多，请进行删减优化。改灯码最多分享12盏灯光。');
        var w=new BitWriter();
        // MP4：改灯码 V4。只编码当前灯光列表参数，不包含动作、动画、全局控制等数据。
        w.write(77,8);w.write(80,8);w.write(52,8);w.write(ls.length,8);
        ls.forEach(function(l){
            var tc=typeCode(l.type), flags=(l.enabled?1:0)|(l.meshVisible?2:0)|(l.shadowEnabled?4:0)|(l.shadowBlur?8:0)|(l.locked?16:0);
            var scopeCode=l.scope===LIGHT_SCOPE_MODEL?2:(l.scope===LIGHT_SCOPE_FREE?0:1);
            w.write(tc,2);w.write(flags,5);w.write(shadowMapCode(Number(l.shadowMapSize)||1024),2);w.write(scopeCode,2);
            // 名称：最多8个字符，UTF-8存储；中文通常占3字节。
            var nameBytes=utf8Bytes(sanitizeLightName(l.name||''));
            if(nameBytes.length>24) nameBytes=nameBytes.slice(0,24);
            w.write(nameBytes.length,5);for(var nb=0;nb<nameBytes.length;nb++)w.write(nameBytes[nb],8);
            var p=l.position||[0,0,0]; for(var i=0;i<3;i++)w.write(qSigned(p[i],-819.2,0.1,14),14);
            var d=encodeDirection.apply(null,l.direction||[0,-1,0]);w.write(d[0],8);w.write(d[1],8);
            var r=l.rotation||[0,0,0];for(var j=0;j<3;j++)w.write(qAngleRad(r[j]),10);
            var c=l.color||[1,1,1];for(var k=0;k<3;k++)w.write(clamp(Math.round((Number(c[k])||0)*255),0,255),8);
            // 亮度：0~2，0.01 精度；与 V3.2.1/V3.2 UI一致。
            w.write(clamp(Math.round((Number(l.intensity)||0)*100),0,200),8);
            if(tc===3){
                // 聚光灯光照范围：1~180°，1°精度。
                w.write(clamp(Math.round(Number(l.angle)||60),1,180)-1,8);
                // 原生 exponent：0~655.35，0.01 精度。
                w.write(clamp(Math.round((Number(l.exponent)||0)*100),0,65535),16);
            } else if(tc===2){
                // 点光源光照范围：0~104857.5，0.1 精度。
                w.write(clamp(Math.round((Number(l.range)||0)*10),0,1048575),20);
            }
        });
        var bytes=w.finish();
        return 'MMDPLAY_'+b64url(bytes)+'_'+fnv16(bytes)+'_MMDPLAY';
    }

    function decodeMMDPlayCode(code){
        code=String(code||'').trim();
        var m=code.match(/^MMDPLAY_([A-Za-z0-9_-]+)_([0-9a-fA-F]{4})_MMDPLAY$/);
        if(!m)throw new Error('不是有效的 MMDPLAY 改灯码');
        var bytes;try{bytes=fromB64url(m[1]);}catch(e){throw new Error('改灯码数据损坏');}
        if(fnv16(bytes).toLowerCase()!==m[2].toLowerCase())throw new Error('校验失败，改灯码可能已损坏');
        var r=new BitReader(bytes);if(r.read(8)!==77||r.read(8)!==80||r.read(8)!==52)throw new Error('改灯码版本不正确');
        var count=r.read(8);if(count>LIGHT_CODE_MAX)throw new Error('灯光数量超过12盏，改灯码最多支持12盏灯光');
        var ls=[];
        for(var n=0;n<count;n++){
            var tc=r.read(2),flags=r.read(5),sm=r.read(2),scopeCode=r.read(2),nameLen=r.read(5),nameBytes=[];
            for(var nb=0;nb<nameLen;nb++)nameBytes.push(r.read(8));
            var name='';try{name=new TextDecoder('utf-8').decode(new Uint8Array(nameBytes));}catch(e){name='';}
            name=sanitizeLightName(name);
            var p=[],d=[],rot=[],col=[];
            for(var i=0;i<3;i++)p.push(dSigned(r.read(14),-819.2,0.1));
            d=decodeDirection(r.read(8),r.read(8));
            for(var j=0;j<3;j++)rot.push(dAngleRad(r.read(10)));
            for(var k=0;k<3;k++)col.push(r.read(8)/255);
            var intensity=r.read(8)/100,angle=0,exponent=0,range=0;
            if(tc===3){angle=r.read(8)+1;exponent=r.read(16)/100;}
            else if(tc===2){range=r.read(20)/10;}
            ls.push({name:name,type:codeType(tc),position:p,direction:d,rotation:rot,color:col,intensity:intensity,enabled:!!(flags&1),meshVisible:!!(flags&2),shadowEnabled:!!(flags&4),shadowBlur:!!(flags&8),locked:!!(flags&16),scope:scopeCode===2?LIGHT_SCOPE_MODEL:(scopeCode===0?LIGHT_SCOPE_FREE:LIGHT_SCOPE_GLOBAL),shadowMapSize:shadowMapValue(sm),angle:angle,exponent:exponent,range:range});
        }
        return {name:'分享灯光',lights:ls,timeText:new Date().toLocaleString()};
    }

    function closeLM2Dialog(){var old=document.getElementById('lm2-dialog-overlay');if(old&&old.parentNode)old.parentNode.removeChild(old);}
    function createLM2Dialog(titleText,bodyText,initialValue,buttons){
        closeLM2Dialog();var overlay=document.createElement('div');overlay.id='lm2-dialog-overlay';overlay.style.cssText='position:fixed;inset:0;z-index:2147483647;background:rgba(0,0,0,.45);display:flex;align-items:center;justify-content:center;padding:18px;box-sizing:border-box;';
        var box=document.createElement('div');box.style.cssText='width:min(92vw,520px);max-height:86vh;overflow:auto;background:var(--color-surface,#fff);color:var(--text-primary,#222);border:1px solid var(--color-border,#ddd);border-radius:14px;padding:16px;box-sizing:border-box;box-shadow:0 12px 40px rgba(0,0,0,.25);';overlay.appendChild(box);
        var title=document.createElement('div');title.textContent=titleText;title.style.cssText='font-size:16px;font-weight:700;margin-bottom:8px;';box.appendChild(title);
        var body=document.createElement('div');body.textContent=bodyText;body.style.cssText='font-size:12px;line-height:1.5;color:var(--text-secondary,#666);margin-bottom:10px;';box.appendChild(body);
        var area=document.createElement('textarea');area.value=initialValue||'';area.style.cssText='width:100%;min-height:150px;max-height:45vh;box-sizing:border-box;padding:10px;border:1px solid var(--color-border,#ccc);border-radius:9px;background:var(--color-bg,#fafafa);color:var(--text-primary,#222);font-size:12px;line-height:1.45;resize:vertical;';box.appendChild(area);
        var row=document.createElement('div');row.style.cssText='display:flex;gap:8px;margin-top:12px;justify-content:flex-end;';buttons.forEach(function(def){var b=document.createElement('button');b.className='mp-btn'+(def.primary?' primary':'');b.textContent=def.label;b.style.cssText='min-height:40px;padding:8px 14px;';b.addEventListener('click',function(){def.onClick(area,overlay);});row.appendChild(b);});box.appendChild(row);document.body.appendChild(overlay);setTimeout(function(){try{area.focus();area.select();}catch(e){}},0);return{overlay:overlay,area:area};
    }
    function copyTextCompat(text,done){text=String(text||'');if(navigator.clipboard&&typeof navigator.clipboard.writeText==='function'){navigator.clipboard.writeText(text).then(done).catch(function(){fallbackCopyText(text,done);});}else fallbackCopyText(text,done);}
    function fallbackCopyText(text,done){var ta=document.createElement('textarea');ta.value=text;ta.style.cssText='position:fixed;left:-9999px;top:-9999px;opacity:0;';document.body.appendChild(ta);ta.focus();ta.select();var ok=false;try{ok=document.execCommand('copy');}catch(e){}document.body.removeChild(ta);if(ok)done();else toast.info('请长按改灯码文本并手动复制',2600);}

    function makeImportedPresetName(){var base='分享灯光';if(!userLightPresets.some(function(p){return p.name===base;}))return base;var i=2;while(userLightPresets.some(function(p){return p.name===base+' '+i;}))i++;return base+' '+i;}
    function shareUserPreset(){
        if(!lights||lights.size===0){toast.info('当前灯光列表为空，无法生成改灯码',1800);return;}
        if(lights.size>LIGHT_CODE_MAX){toast.info('灯光过多，请进行删减优化。改灯码最多分享12盏灯光。当前：'+lights.size+' / 12',2600);return;}
        var code;try{code=encodeCurrentLightList();}catch(e){toast.error('改灯码生成失败：'+(e&&e.message?e.message:'未知错误'),2600);return;}
        createLM2Dialog('分享 MMDPLAY 改灯码','已提取当前灯光列表的完整参数。复制下面的改灯码，可在另一台设备导入。',code,[{label:'关闭',onClick:function(){closeLM2Dialog();}},{label:'复制改灯码',primary:true,onClick:function(area){copyTextCompat(area.value,function(){toast.success('改灯码已复制',1800);});}}]);
    }
    function importUserPreset(){
        createLM2Dialog('导入 MMDPLAY 改灯码','粘贴分享的 MMDPLAY 改灯码。导入后只新增到“用户偏好”，不会改变当前灯光列表。',[].join(''),[{label:'取消',onClick:function(){closeLM2Dialog();}},{label:'导入',primary:true,onClick:function(area){var code=String(area.value||'').trim();if(!code){toast.info('请先粘贴 MMDPLAY 改灯码',1800);return;}if(userLightPresets.length>=USER_PRESET_MAX){toast.info('用户预设已达到上限（12个），请先删除一个预设。',2200);return;}try{var p=decodeMMDPlayCode(code);if(!p.lights||p.lights.length>LIGHT_CODE_MAX)throw new Error('灯光数量超过12盏，无法导入');var name=makeImportedPresetName();p.name=name;userLightPresets.push(p);saveUserPresets().then(function(){refreshUserPresetDropdown();closeLM2Dialog();toast.success('已导入“'+name+'”，当前灯光未改变',2200);}).catch(function(){userLightPresets.pop();toast.error('导入后保存失败',2200);});}catch(e){toast.error('导入失败：'+(e&&e.message?e.message:'改灯码无效'),2600);}}}]);
    }

    function canFitLights(addCount) {
        var need = Math.max(0, Number(addCount) || 0);
        return lights.size + need <= PLUGIN_LIGHT_LIMIT;
    }

    function restoreLightSnapshot(snapshot, replaceCurrent) {
        if(!scene||!Array.isArray(snapshot))return;
        if(snapshot.length > USER_PRESET_LIGHT_MAX) { toast.info('灯光过多，请进行删减优化。该用户预设超过16盏灯光，无法执行。', 2600); return; }
        if(!replaceCurrent && !canFitLights(snapshot.length)) { toast.info('灯光过多，请进行删减优化。追加后最多允许16盏灯光。', 2600); return; }
        if(replaceCurrent)clearAllLights();
        beginBatchUpdate();
        var restored=0;
        snapshot.forEach(function(cfg){
            var before=lightCounter; createLight(cfg.type,cfg.position||[0,0,0],{r:(cfg.color||[1,1,1])[0],g:(cfg.color||[1,1,1])[1],b:(cfg.color||[1,1,1])[2]},Number(cfg.intensity)||0);
            var info=null; lights.forEach(function(v){if(!info&&v&&v.id&&v.name&&v.name.endsWith(' '+lightCounter))info=v;}); if(!info||lightCounter<=before)return;
            if (cfg.name != null) {
                var restoredName = sanitizeLightName(cfg.name);
                if (restoredName) { info.name = restoredName; updateLightRowUI(info); }
            }
            // 完整恢复灯光属性：创建灯光后再次显式写回强度、颜色、方向和启用状态，避免宿主/全局倍率导致恢复后
            // 灯光对象存在但实际照明强度为 0。保存的是用户原始强度，实际 Babylon 强度统一由全局倍率计算。
            if (info.light) {
                var restoreColor = cfg.color || [1,1,1];
                info.color = {r:Number(restoreColor[0])||0,g:Number(restoreColor[1])||0,b:Number(restoreColor[2])||0};
                info.light.diffuse = new BABYLON.Color3(info.color.r, info.color.g, info.color.b);
                info.intensity = Math.max(0, Number(cfg.intensity) || 0);
                info.light.intensity = info.intensity * globalIntensityMultiplier;
                if (info.light.specular) info.light.specular = new BABYLON.Color3(1,1,1);
            }
            if(info.type==='spot'){
                var restoredAngle = cfg.angle != null ? Number(cfg.angle) : (cfg.area != null ? Number(cfg.area) : degreesFromRadians(info.light.angle));
                var restoredExponent = cfg.exponent != null ? Number(cfg.exponent) : (cfg.softness != null ? legacySoftnessToSpotExponent(Number(cfg.softness)) : getSpotExponent(info));
                if(isFinite(restoredAngle)) updateLightAngle(info,restoredAngle);
                if(isFinite(restoredExponent)) applyLightSoftness(info,restoredExponent);
                if(cfg.range != null && isFinite(Number(cfg.range))) { try { info.light.range=Math.max(0,Number(cfg.range)); info.range=info.light.range; } catch(e) {} }
            } else if(info.type==='point'){
                var restoredRange = cfg.range != null ? Number(cfg.range) : (cfg.area != null ? Number(cfg.area) : getLightRange(info));
                if(isFinite(restoredRange)) applyLightArea(info,restoredRange);
            }
            if(info.light.direction&&cfg.direction)info.light.direction=new BABYLON.Vector3(cfg.direction[0],cfg.direction[1],cfg.direction[2]);
            if(info.mesh&&cfg.rotation){info.mesh.rotation.x=cfg.rotation[0]||0;info.mesh.rotation.y=cfg.rotation[1]||0;info.mesh.rotation.z=cfg.rotation[2]||0;updateLightTransformFromMesh(info,info.mesh); if(cfg.direction)info.light.direction=new BABYLON.Vector3(cfg.direction[0],cfg.direction[1],cfg.direction[2]);}
            info.enabled=cfg.enabled!==false; info.meshVisible=cfg.meshVisible!==false; info.shadowMapSize=cfg.shadowMapSize||SHADOW_MAP_SIZE_DEFAULT; info.shadowBlur=!!cfg.shadowBlur; info.locked=!!cfg.locked; info.scope=cfg.scope||LIGHT_SCOPE_GLOBAL; if(info.light)info.light.__mikuplayLocked=info.locked;
            if(cfg.shadowEnabled&&hasShadowSupport(info))setShadowEnabled(info,true);
            // 阴影创建/变换更新后再写一次强度，确保 ShadowGenerator 或宿主实现没有覆盖 intensity。
            if(info.light){ info.light.intensity = info.intensity * globalIntensityMultiplier; info.light.setEnabled(info.enabled&&globalLightEnabled); }
            if(info.mesh)info.mesh.setEnabled(info.enabled&&info.meshVisible);
            if(info.type==='point'||info.type==='spot'){ if(info.scope===LIGHT_SCOPE_MODEL && lightScopeTargetModelId){ setLightScope(info,LIGHT_SCOPE_MODEL,getTargetModelMeshes()); } else if(info.scope===LIGHT_SCOPE_GLOBAL){ setLightScope(info,LIGHT_SCOPE_GLOBAL,[]); } }
            updateLightRowUI(info);
            if(info.toggleBtn){info.toggleBtn.textContent=info.enabled?'隐藏':'显示';info.uiElement.style.opacity=info.enabled?'1':'0.5';}
            restored++;
        });
        endBatchUpdate();
        applyGlobalIntensityMultiplier();toast.success('已恢复 '+restored+' 盏灯光',2200);
    }

    function beginBatchUpdate() {
        batchUpdateDepth++;
    }

    function endBatchUpdate() {
        if (batchUpdateDepth > 0) batchUpdateDepth--;
        if (batchUpdateDepth === 0) {
            if (pendingGlobalUpdate) {
                pendingGlobalUpdate = false;
                applyMaxSimultaneousLights(maxSimultaneousLights);
                applyPBRCompensation();
            }
            if (pendingScopeUpdate) {
                pendingScopeUpdate = false;
                applyLightScopeMode();
            }
        }
    }

    function requestGlobalMaterialUpdate() {
        if (batchUpdateDepth > 0) {
            pendingGlobalUpdate = true;
            return;
        }
        applyMaxSimultaneousLights(maxSimultaneousLights);
        applyPBRCompensation();
    }

    /**
     * 将"最大同时生效灯光数"应用到场景中的所有材质
     * @param {number} count - 最大同时生效灯光数
     * @returns {number} 已应用的材质数量
     */
    function applyMaxSimultaneousLights(count) {
        if (!scene) return 0;
        count = Math.max(MAX_LIGHTS_MIN, Math.min(PLUGIN_LIGHT_LIMIT, Math.floor(Number(count) || MAX_LIGHTS_DEFAULT)));

        var applied = 0;
        ensureMaterialCache().forEach(function(mat) {
            if (mat && typeof mat.maxSimultaneousLights === 'number' && mat.maxSimultaneousLights !== count) {
                mat.maxSimultaneousLights = count;
                applied++;
            }
        });
        return applied;
    }

    /**
     * 创建灯光组合预设区域
     */
    function createPresetSection() {
        var section = makeCollapsibleSection('灯光预设', 'v2-preset-section');
        var body = section.body;

        var tip=document.createElement('div');
        tip.style.cssText='font-size:10px;color:var(--text-secondary);line-height:1.4;margin-bottom:8px;';
        tip.textContent='官方布光、氛围灯与用户偏好预设分开管理。';
        body.appendChild(tip);

        function makePresetColumn(titleText, dropdownOptions, selectedValue, placeholder, descColor){
            var wrap=document.createElement('div');
            wrap.style.cssText='padding:8px 9px;margin-bottom:8px;border:1px solid var(--color-border);border-radius:var(--radius-md);background:var(--color-bg);';
            var title=document.createElement('div'); title.textContent=titleText; title.style.cssText='font-size:12px;font-weight:700;color:var(--text-primary);margin-bottom:6px;'; wrap.appendChild(title);
            var dropdown=new Dropdown({options:dropdownOptions,selectedValue:selectedValue,placeholder:placeholder});
            wrap.appendChild(dropdown.element);
            var desc=document.createElement('div'); desc.style.cssText='font-size:10px;color:'+(descColor||'var(--text-disabled)')+';line-height:1.4;margin:5px 0 7px;min-height:16px;'; wrap.appendChild(desc);
            var actions=document.createElement('div'); actions.style.cssText='display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:6px;'; wrap.appendChild(actions);
            function add(text,fn,cls){var b=document.createElement('button');b.type='button';b.className='mp-btn small'+(cls?' '+cls:'');b.textContent=text;b.style.cssText='min-height:34px;padding:4px 5px;font-size:11px;font-weight:600;';b.addEventListener('click',fn);actions.appendChild(b);}
            return {wrap:wrap,dropdown:dropdown,desc:desc,add:add};
        }

        var official=makePresetColumn('官方布光',LIGHT_PRESETS.map(function(p){return{value:p.value,label:p.label};}),LIGHT_PRESETS[0].value,'选择官方布光预设');
        function refreshOfficialDesc(){var p=LIGHT_PRESETS.find(function(x){return x.value===official.dropdown.getValue();});official.desc.textContent=p?p.description:'';}
        if(official.dropdown.onChange) official.dropdown.onChange(refreshOfficialDesc); refreshOfficialDesc();
        official.add('替换',function(){applyLightPreset(official.dropdown.getValue(),true);},'primary');
        official.add('清空',function(){if(window.confirm('确定清空当前全部灯光吗？')){beginBatchUpdate();clearAllLights();endBatchUpdate();toast.success('已清空所有灯光',1800);}});
        official.add('追加',function(){applyLightPreset(official.dropdown.getValue(),false);});
        body.appendChild(official.wrap);

        var atmosphere=makePresetColumn('氛围灯预设',ATMOSPHERE_PRESETS.map(function(p){return{value:p.value,label:p.label};}),ATMOSPHERE_PRESETS[0].value,'选择氛围灯效果');
        function refreshAtmosphereDesc(){var p=ATMOSPHERE_PRESETS.find(function(x){return x.value===atmosphere.dropdown.getValue();});atmosphere.desc.textContent=p?p.description:'';}
        if(atmosphere.dropdown.onChange) atmosphere.dropdown.onChange(refreshAtmosphereDesc); refreshAtmosphereDesc();
        atmosphere.add('替换',function(){applyAtmospherePreset(atmosphere.dropdown.getValue(),true);},'primary');
        atmosphere.add('清空',function(){if(window.confirm('确定清空当前全部灯光吗？')){beginBatchUpdate();clearAllLights();endBatchUpdate();toast.success('已清空所有灯光',1800);}});
        atmosphere.add('追加',function(){applyAtmospherePreset(atmosphere.dropdown.getValue(),false);});
        body.appendChild(atmosphere.wrap);

        // 用户偏好：选择器 → 保存/导入/分享 → 重命名/删除。
        var userWrap=document.createElement('div');
        userWrap.style.cssText='padding:8px 9px;border:1px solid var(--color-border);border-radius:var(--radius-md);background:var(--color-bg);';
        var userTitle=document.createElement('div'); userTitle.textContent='用户偏好'; userTitle.style.cssText='font-size:12px;font-weight:700;color:var(--text-primary);margin-bottom:6px;'; userWrap.appendChild(userTitle);
        var host=document.createElement('div'); host.style.cssText='margin:0;'; userWrap.appendChild(host); userPresetDropdownHost=host;
        var ud=document.createElement('div'); userPresetDesc=ud; ud.style.cssText='font-size:10px;color:var(--text-disabled);margin:5px 0 7px;min-height:16px;line-height:1.4;'; userWrap.appendChild(ud);

        // 用户预设固定为两行三列：保存 / 导入 / 分享 + 替换 / 重命名 / 删除。
        // 用户预设只允许“替换到场景”，不提供“追加”，避免与官方/氛围预设的追加逻辑混淆。
        var codeTip=document.createElement('div'); codeTip.textContent='最多分享和导入12个灯。改灯码仅包含当前灯光列表参数，不包含动作、动画和全局控制。'; codeTip.style.cssText='font-size:10px;color:var(--color-warning,#a66);line-height:1.4;margin:2px 0 7px;'; userWrap.appendChild(codeTip);
        var userActions=document.createElement('div');
        userActions.style.cssText='display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:6px;';
        function userBtn(text,fn,cls){var b=document.createElement('button');b.type='button';b.className='mp-btn small'+(cls?' '+cls:'');b.textContent=text;b.style.cssText='min-height:34px;padding:4px 5px;font-size:11px;font-weight:600;';b.addEventListener('click',fn);userActions.appendChild(b);}
        userBtn('保存',saveCurrentAsUserPreset,'primary');
        userBtn('导入',importUserPreset);
        userBtn('分享',shareUserPreset);
        userBtn('替换',function(){
            var p=selectedUserPreset();
            if(p) restoreLightSnapshot(p.lights,true);
            else toast.info('请先在用户偏好中选择预设',1800);
        },'primary');
        userBtn('重命名预设',renameSelectedUserPreset);
        userBtn('删除选中预设',deleteSelectedUserPreset,'danger');
        userWrap.appendChild(userActions);
        body.appendChild(userWrap);
        refreshUserPresetDropdown();
        return section;
    }

    /**
     * 应用一个多灯组合预设
     */
    function applyLightPreset(value, replaceCurrent) {
        var preset = LIGHT_PRESETS.find(function(p) { return p.value === value; });
        if (!preset || !scene) return;
        if (preset.lights.length > PLUGIN_LIGHT_LIMIT) { toast.info('灯光过多，请进行删减优化。该官方预设超过24盏灯光。', 2400); return; }
        if (!replaceCurrent && !canFitLights(preset.lights.length)) { toast.info('灯光过多，请进行删减优化。追加后最多允许16盏灯光。', 2400); return; }

        if (replaceCurrent) clearAllLights();

        beginBatchUpdate();
        var created = [];
        for (var i = 0; i < preset.lights.length; i++) {
            var cfg = preset.lights[i];
            var before = lightCounter;
            createLight(cfg.type, cfg.pos || [0,0,0], cfg.color || {r:1,g:1,b:1}, cfg.intensity);

            // createLight 同步写入 Map，取刚创建的最后一盏灯
            var info = null;
            lights.forEach(function(v) { if (v && v.id && v.name && !info && v.id.indexOf('light_') === 0 && v.name.endsWith(' ' + lightCounter)) info = v; });
            if (!info || lightCounter <= before) continue;

            if (cfg.angle && info.type === 'spot') { updateLightAngle(info, cfg.angle); }

            if (cfg.target && info.type === 'spot') {
                var p = info.light.position;
                var t = cfg.target;
                var dir = new BABYLON.Vector3(t[0] - p.x, t[1] - p.y, t[2] - p.z);
                if (dir.length() > 0.0001) {
                    dir.normalize();
                    info.light.direction = dir;
                }
            } else if (cfg.direction && info.light.direction) {
                info.light.direction = new BABYLON.Vector3(cfg.direction[0], cfg.direction[1], cfg.direction[2]);
            }

            if (cfg.shadow && hasShadowSupport(info)) {
                info.shadowMapSize = 1024;
                info.shadowBlur = false;
                setShadowEnabled(info, true);
            }
            created.push(info);
        }

        endBatchUpdate();
        updateLightCount();
        toast.success('已应用预设：' + preset.label + '（' + created.length + ' 盏灯）', 2200);
    }

    /**
     * 应用彩色氛围灯预设。氛围灯默认关闭阴影，避免彩色辅助光造成额外阴影开销与画面脏乱。
     */
    function applyAtmospherePreset(value, replaceCurrent) {
        var preset = ATMOSPHERE_PRESETS.find(function(p) { return p.value === value; });
        if (!preset || !scene) return;
        if (preset.lights.length > PLUGIN_LIGHT_LIMIT) { toast.info('灯光过多，请进行删减优化。该氛围预设超过24盏灯光。', 2400); return; }
        if (!replaceCurrent && !canFitLights(preset.lights.length)) { toast.info('灯光过多，请进行删减优化。追加后最多允许16盏灯光。', 2400); return; }
        if (replaceCurrent) clearAllLights();

        beginBatchUpdate();
        var created = [];
        for (var i = 0; i < preset.lights.length; i++) {
            var cfg = preset.lights[i];
            var before = lightCounter;
            createLight(cfg.type, cfg.pos || [0,0,0], cfg.color || {r:1,g:1,b:1}, cfg.intensity);
            var info = null;
            lights.forEach(function(v) { if (v && v.id && v.name && !info && v.id.indexOf('light_') === 0 && v.name.endsWith(' ' + lightCounter)) info = v; });
            if (!info || lightCounter <= before) continue;
            if (cfg.angle && info.type === 'spot') { updateLightAngle(info, cfg.angle); }
            if (cfg.target && info.type === 'spot') {
                var p = info.light.position, t = cfg.target;
                var dir = new BABYLON.Vector3(t[0] - p.x, t[1] - p.y, t[2] - p.z);
                if (dir.length() > 0.0001) { dir.normalize(); info.light.direction = dir; }
            }
            if (cfg.shadow && hasShadowSupport(info)) setShadowEnabled(info, true);
            created.push(info);
        }
        endBatchUpdate();
        updateLightCount();
        toast.success('已应用氛围灯：' + preset.label + '（' + created.length + ' 盏灯）', 2200);
    }

    function createV2OperationSection() {
        var section=document.createElement('div');
        section.style.cssText='background:var(--color-surface);border-radius:var(--radius-md);padding:12px;border:1px solid var(--color-border);';
        var title=document.createElement('div'); title.style.cssText='font-size:14px;font-weight:600;margin-bottom:10px;color:var(--text-primary);'; title.textContent='操作'; section.appendChild(title);
        var grid=document.createElement('div'); grid.style.cssText='display:grid;grid-template-columns:1fr 1fr;gap:8px;';
        function btn(text,fn,cls){var b=document.createElement('button');b.className='mp-btn'+(cls?' '+cls:'');b.style.cssText='min-height:42px;font-size:13px;';b.textContent=text;b.addEventListener('click',fn);grid.appendChild(b);}
        btn('替换',function(){
            var p=selectedUserPreset(); if(p)restoreLightSnapshot(p.lights,true); else toast.info('请先在用户偏好中选择预设',1800);
        },'primary');
        btn('保存',saveCurrentAsUserPreset);
        btn('追加',function(){
            var p=selectedUserPreset(); if(p)restoreLightSnapshot(p.lights,false); else toast.info('请先在用户偏好中选择预设',1800);
        });
        btn('导入',importUserPreset);
        btn('清空',function(){clearAllLights();toast.success('已清空所有灯光',1800);},'danger');
        btn('分享',shareUserPreset);
        section.appendChild(grid); return section;
    }

    /**
     * 创建"新建灯光"区域
     */
    function createCreateLightSection() {
        var section = document.createElement('div');
        section.style.cssText = 'background: var(--color-surface); border-radius: var(--radius-md); padding: 12px; border: 1px solid var(--color-border);';

        var title = document.createElement('div');
        title.style.cssText = 'font-size: 14px; font-weight: 600; margin-bottom: 12px; color: var(--text-primary);';
        title.textContent = '创建新灯光';
        section.appendChild(title);

        // 灯光类型选择
        var typeRow = document.createElement('div');
        typeRow.style.cssText = 'margin-bottom: 12px;';

        var typeLabel = document.createElement('div');
        typeLabel.style.cssText = 'font-size: 12px; color: var(--text-secondary); margin-bottom: 6px;';
        typeLabel.textContent = '灯光类型';
        typeRow.appendChild(typeLabel);

        var typeDropdown = new Dropdown({
            options: LIGHT_TYPES,
            selectedValue: 'hemispheric',
            placeholder: '选择灯光类型'
        });
        typeRow.appendChild(typeDropdown.element);
        section.appendChild(typeRow);

        // 初始位置输入
        var posRow = document.createElement('div');
        posRow.style.cssText = 'margin-bottom: 12px;';

        var posLabel = document.createElement('div');
        posLabel.style.cssText = 'font-size: 12px; color: var(--text-secondary); margin-bottom: 6px;';
        posLabel.textContent = '初始位置';
        posRow.appendChild(posLabel);

        var posInput = new VectorInput({
            label: '',
            components: [
                { name: 'X', value: 0, min: -100, max: 100, step: 0.1 },
                { name: 'Y', value: 10, min: -100, max: 100, step: 0.1 },
                { name: 'Z', value: 0, min: -100, max: 100, step: 0.1 }
            ]
        });
        posRow.appendChild(posInput.element);
        section.appendChild(posRow);

        // 初始颜色
        var colorRow = document.createElement('div');
        colorRow.style.cssText = 'margin-bottom: 12px;';

        var colorPicker = new RGBColorPicker({
            label: '初始颜色',
            color: { r: 1, g: 1, b: 1 },
            mode: 'popup'
        });
        colorRow.appendChild(colorPicker.element);
        var initialQuickBtn = document.createElement('button');
        initialQuickBtn.className = 'mp-btn small';
        initialQuickBtn.textContent = '🎨 快速选色';
        initialQuickBtn.style.cssText = 'margin-top: 6px; width: 100%; padding: 6px 8px; font-size: 11px;';
        initialQuickBtn.addEventListener('click', function() {
            openQuickColorPicker(null, colorPicker);
        });
        colorRow.appendChild(initialQuickBtn);
        section.appendChild(colorRow);

        // 初始强度
        var intensityRow = document.createElement('div');
        intensityRow.style.cssText = 'margin-bottom: 12px;';

        var intensitySlider = new Slider({
            label: '初始亮度',
            min: 0,
            max: 100,
            step: 1,
            value: 100,
            showValue: true
        });
        intensityRow.appendChild(intensitySlider.element);
        section.appendChild(intensityRow);

        // 创建按钮
        var createBtn = document.createElement('button');
        createBtn.className = 'mp-btn primary';
        createBtn.style.cssText = 'width: 100%; margin-top: 8px;';
        createBtn.textContent = '创建灯光';
        createBtn.addEventListener('click', function() {
            var type = typeDropdown.getValue();
            var pos = posInput.getValue();
            var color = colorPicker.__quickColor || colorPicker.getValue();
            var intensity = Number(intensityInput.value) || 0;

            createLight(type, pos, color, intensity);
        });
        section.appendChild(createBtn);

        return section;
    }

    /**
     * 创建灯光列表区域
     */
    function createLightListSection() {
        var section=makeCollapsibleSection('灯光列表','light-list-section');
        var body=section.body;
        var listContainer=document.createElement('div');
        listContainer.className='light-list-container';
        listContainer.style.cssText='display:flex;flex-direction:column;gap:5px;max-height:340px;overflow-y:auto;';
        body.appendChild(listContainer);
        section.listContainer=listContainer;
        var titleCount=document.createElement('span'); titleCount.className='light-count'; titleCount.textContent='(0)';
        // 将数量显示到标题按钮右侧
        var head=section.querySelector('button'); if(head){var t=head.querySelector('span');if(t){var wrap=document.createElement('span');wrap.textContent='灯光列表 ';wrap.appendChild(titleCount);t.replaceWith(wrap);}}
        section.titleCount=titleCount;

        var createWrap=document.createElement('div'); createWrap.style.cssText='border-top:1px dashed var(--color-border);margin-top:8px;padding-top:8px;'; body.appendChild(createWrap);
        var createTitle=document.createElement('div');createTitle.textContent='创建新灯光';createTitle.style.cssText='font-size:12px;font-weight:700;margin-bottom:6px;';createWrap.appendChild(createTitle);
        var typeDropdown=new Dropdown({options:LIGHT_TYPES,selectedValue:'hemispheric',placeholder:'选择灯光类型'});createWrap.appendChild(typeDropdown.element);
        var posInput=new VectorInput({label:'初始位置',components:[{name:'X',value:0,min:-100,max:100,step:0.1},{name:'Y',value:10,min:-100,max:100,step:0.1},{name:'Z',value:0,min:-100,max:100,step:0.1}]});createWrap.appendChild(posInput.element);
        var colorPicker=new RGBColorPicker({label:'初始颜色',color:{r:1,g:1,b:1},mode:'popup'});createWrap.appendChild(colorPicker.element);
        var intensityRow=document.createElement('div'); intensityRow.style.cssText='margin:8px 0 6px;';
        var intensitySlider=new Slider({label:'初始亮度',min:0,max:2,step:0.01,value:1,showValue:true});
        intensityRow.appendChild(intensitySlider.element); createWrap.appendChild(intensityRow);
        var createBtn=document.createElement('button');createBtn.className='mp-btn primary';createBtn.textContent='创建灯光';createBtn.style.cssText='width:100%;min-height:38px;font-size:12px;margin-top:5px;';createBtn.addEventListener('click',function(){createLight(typeDropdown.getValue(),posInput.getValue(),colorPicker.__quickColor||colorPicker.getValue(),Number(intensitySlider.getValue())||0);});createWrap.appendChild(createBtn);
        return section;
    }

    /**
     * 初始化Gizmo管理器
     */
    function initGizmoManager() {
        if (!scene) return;

        // 创建Gizmo管理器
        gizmoManager = new BABYLON.GizmoManager(scene);
        gizmoManager.positionGizmoEnabled = true;
        gizmoManager.rotationGizmoEnabled = true;
        gizmoManager.scaleGizmoEnabled = false;
        gizmoManager.usePointerToAttachGizmos = false;

        // 监听Gizmo位置变化
        gizmoObservers.push({ observable: gizmoManager.onAttachedToMeshObservable, observer: gizmoManager.onAttachedToMeshObservable.add(function(mesh) {
            if (mesh && mesh.lightRef) {
                updateLightTransformFromMesh(mesh.lightRef, mesh);
            }
        }) });

        // 监听位置Gizmo拖拽结束
        if (gizmoManager.gizmos.positionGizmo) {
            gizmoObservers.push({ observable: gizmoManager.gizmos.positionGizmo.onDragEndObservable, observer: gizmoManager.gizmos.positionGizmo.onDragEndObservable.add(function() {
                var mesh = gizmoManager.attachedMesh;
                if (mesh && mesh.lightRef) {
                    updateLightTransformFromMesh(mesh.lightRef, mesh);
                    updateLightUI(mesh.lightRef.id);
                }
            }) });
        }

        // 监听旋转Gizmo拖拽结束
        if (gizmoManager.gizmos.rotationGizmo) {
            gizmoObservers.push({ observable: gizmoManager.gizmos.rotationGizmo.onDragEndObservable, observer: gizmoManager.gizmos.rotationGizmo.onDragEndObservable.add(function() {
                var mesh = gizmoManager.attachedMesh;
                if (mesh && mesh.lightRef) {
                    updateLightTransformFromMesh(mesh.lightRef, mesh);
                }
            }) });
        }
    }

    /**
     * 按灯光类型返回强度上限（参照 V1.2.3 的分档策略）：
     * - 点光源：受 PBR 物理衰减（距离平方反比）影响最大，上限 300；
     * - 聚光灯：切回标准衰减后上限 30；
     * - 方向光/环境光：不受衰减影响，保持 3。
     */
    function getIntensityMax(type) {
        if (type === 'point') return 300;
        if (type === 'spot') return 30;
        return 3;
    }

    /**
     * 创建灯光
     */
    function createLight(type, position, color, intensity) {
        if (!scene) return null;
        if (lights.size >= PLUGIN_LIGHT_LIMIT) {
            toast.info('灯光过多，请进行删减优化。灯光管理器最多创建24盏灯光。', 2400);
            return null;
        }

        lightCounter++;
        var lightId = 'light_' + Date.now() + '_' + lightCounter;
        var lightName = getLightTypeLabel(type) + ' ' + lightCounter;

        var light = null;
        var mesh = null;
        var pos = new BABYLON.Vector3(position[0], position[1], position[2]);
        var col = new BABYLON.Color3(color.r, color.g, color.b);

        switch (type) {
            case 'hemispheric':
                light = new BABYLON.HemisphericLight(lightId, new BABYLON.Vector3(0, 1, 0), scene);
                light.groundColor = new BABYLON.Color3(0.2, 0.2, 0.2);
                break;
            case 'directional':
                light = new BABYLON.DirectionalLight(lightId, new BABYLON.Vector3(0, -1, 0), scene);
                light.position = pos;
                // 创建可视化网格
                mesh = createLightMesh('directional', pos, col, lightId);
                break;
            case 'point':
                light = new BABYLON.PointLight(lightId, pos, scene);
                // 创建可视化网格
                mesh = createLightMesh('point', pos, col, lightId);
                break;
            case 'spot':
                light = new BABYLON.SpotLight(lightId, pos, new BABYLON.Vector3(0, -1, 0), Math.PI / 3, 2, scene);
                // 创建可视化网格
                mesh = createLightMesh('spot', pos, col, lightId);
                break;
        }

        if (light) {
            light.diffuse = col;
            // PointLight 的 Babylon 默认 range 是 Number.MAX_VALUE（无限远哨兵值），
            // 对本插件的可视化控制没有实际意义，因此新建点光源统一从 100 的可控范围开始。
            if (type === 'point' && (!isFinite(light.range) || light.range > 1000000)) light.range = 100;
            // 聚光灯标准衰减修复（参照 V1.2.3）：新版宿主 PBR 默认物理衰减使聚光在 MMD 常见场景尺度下
            // 几乎不可见。显式切回标准线性衰减 + 足够大的 range，恢复旧版软件的可见效果。
            if (type === 'spot') {
                try {
                    if (typeof BABYLON.Light !== 'undefined' && typeof BABYLON.Light.FALLOFF_STANDARD === 'number') {
                        light.falloffType = BABYLON.Light.FALLOFF_STANDARD;
                        light.range = 1000;
                    }
                } catch (e) { console.warn('[LightManager] 设置聚光灯标准衰减失败，保持默认:', e); }
            }
            light.intensity = clamp(nativeNumber(intensity, 1), 0, getIntensityMax(type)) * globalIntensityMultiplier;
            light.specular = new BABYLON.Color3(1, 1, 1);


            // 保存灯光信息
            var lightInfo = {
                id: lightId,
                name: lightName,
                type: type,
                light: light,
                mesh: mesh,
                color: color,
                intensity: intensity,
                angle: (type === 'spot') ? light.angle : undefined,
                exponent: (type === 'spot' && typeof light.exponent === 'number') ? light.exponent : undefined,
                range: (typeof light.range === 'number') ? light.range : undefined,
                enabled: true,
                meshVisible: true,  // 可视化网格显示状态
                shadowEnabled: false,        // 阴影发生器是否启用
                shadowMapSize: SHADOW_MAP_SIZE_DEFAULT, // 阴影贴图大小
                shadowBlur: false,           // 是否使用模糊阴影（PCF）
                shadowGenerator: null,       // BABYLON.ShadowGenerator 实例
                shadowToggle: null,          // 阴影开关 UI 引用
                shadowAdvanced: null,        // 阴影高级设置容器引用
                locked: false,
                scope: LIGHT_SCOPE_GLOBAL,
                softness: (type === 'spot' && typeof light.exponent === 'number') ? light.exponent : undefined,
                area: (type === 'spot') ? degreesFromRadians(light.angle) : (typeof light.range === 'number' ? light.range : undefined),
                uiElement: null
            };

            if (mesh) {
                mesh.lightRef = lightInfo;
            }

            light.__mikuplayLocked = false;
            light.__mikuplayScope = LIGHT_SCOPE_GLOBAL;
            lights.set(lightId, lightInfo);
            addLightToUI(lightInfo);
            updateLightCount();
            refreshAnimLightList();

            // 单灯创建不再立即扫描整个场景；批量操作结束后统一刷新。
            requestGlobalMaterialUpdate();
            if (lightScopeMode !== LIGHT_SCOPE_FREE) {
                if (batchUpdateDepth > 0) pendingScopeUpdate = true;
                else applyLightScopeMode();
            }

            toast.success('灯光 "' + lightName + '" 已创建', 2000);
        }
    }

    /**
     * 创建灯光可视化网格
     */
    function createLightMesh(type, position, color, lightId) {
        var mesh = null;
        var mat = new BABYLON.StandardMaterial(lightId + '_mat', scene);
        mat.emissiveColor = new BABYLON.Color3(color.r, color.g, color.b);
        mat.disableLighting = true;
        mat.wireframe = true;

        if (type === 'point') {
            mesh = BABYLON.MeshBuilder.CreateSphere(lightId + '_mesh', { diameter: 0.5 }, scene);
        } else if (type === 'spot') {
            // 聚光灯：增大尺寸并改为线框显示（小口朝上、大口朝下，视觉上呈向下照射的光锥）
            // 注意：不能翻转 rotation.x（旧版为 Math.PI）。网格旋转会被 updateLightTransformFromMesh
            // 用于反推灯光方向，翻转会导致 Gizmo 拖拽后聚光灯方向变成朝上、完全照不到模型。
            mesh = BABYLON.MeshBuilder.CreateCylinder(lightId + '_mesh', { diameterTop: 0.3, diameterBottom: 6, height: 9, tessellation: 32 }, scene);
        } else if (type === 'directional') {
            // 方向光：使用线框圆柱体表示
            mesh = BABYLON.MeshBuilder.CreateCylinder(lightId + '_mesh', { diameterTop: 5, diameterBottom: 5, height: 15, tessellation: 16 }, scene);
            mesh.rotation.x = Math.PI / 2;
        }

        if (mesh) {
            mesh.position = position;
            mesh.material = mat;
            mesh.isPickable = true;
        }

        return mesh;
    }

    /**
     * 更新灯光变换（位置和旋转）
     */
    function updateLightTransformFromMesh(lightInfo, mesh) {
        if (!lightInfo || !mesh) return;

        var pos = mesh.position;
        var rot = mesh.rotation;

        switch (lightInfo.type) {
            case 'directional':
                lightInfo.light.position = pos.clone();
                // 方向光：根据旋转更新方向
                var direction = new BABYLON.Vector3(0, -1, 0);
                direction.rotateByQuaternionToRef(BABYLON.Quaternion.FromEulerAngles(rot.x, rot.y, rot.z), direction);
                lightInfo.light.direction = direction;
                break;
            case 'point':
                lightInfo.light.position = pos.clone();
                break;
            case 'spot':
                lightInfo.light.position = pos.clone();
                // 聚光灯：根据旋转更新方向
                var spotDirection = new BABYLON.Vector3(0, -1, 0);
                spotDirection.rotateByQuaternionToRef(BABYLON.Quaternion.FromEulerAngles(rot.x, rot.y, rot.z), spotDirection);
                lightInfo.light.direction = spotDirection;
                break;
        }
    }

    // 灯光名称：仅允许中文、英文、数字、空格和常用标点，最多8个字符。
    function sanitizeLightName(value) {
        var text=String(value==null?'':value).trim();
        text=text.replace(/[^\u3400-\u9FFF\u3000-\u303F\uFF00-\uFF65A-Za-z0-9 _.,!?;:'\"\-+()\[\]{}<>/\\@#$%&*=|~`]/g,'');
        return Array.from(text).slice(0,8).join('');
    }

    function renameLight(lightInfo) {
        if(!lightInfo) return;
        var current=String(lightInfo.name||'').slice(0,8);
        var entered=window.prompt('请输入灯光名称（最多8个字符，仅支持中文、英文、数字和常用标点）：',current);
        if(entered===null) return;
        var name=sanitizeLightName(entered);
        if(!name){ toast.info('名称不能为空，且只能使用中文、英文、数字和常用标点。',2200); return; }
        lightInfo.name=name;
        updateLightRowUI(lightInfo);
        if(lightInfo.detailTitleEl) lightInfo.detailTitleEl.textContent=(lightInfo.locked?'🔒 ':'')+lightInfo.name;
        toast.success('灯光名称已修改为“'+name+'”',1800);
    }

    /**
     * 添加灯光到UI
     */
    function addLightToUI(lightInfo) {
        var listSection=container.querySelector('.light-list-section'); if(!listSection)return;
        var listContainer=listSection.listContainer; if(!listContainer)return;
        var item=document.createElement('div'); item.className='light-item'; item.dataset.lightId=lightInfo.id;
        item.style.cssText='display:grid;grid-template-columns:minmax(0,2.6fr) minmax(44px,.8fr) minmax(48px,.8fr) minmax(48px,.9fr);gap:4px;align-items:stretch;';

        var nameBtn=document.createElement('button'); nameBtn.type='button'; nameBtn.className='mp-btn small';
        nameBtn.style.cssText='min-height:38px;text-align:left;padding:6px 7px;font-size:11px;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;';
        nameBtn.title='点击修改灯光名称';
        nameBtn.addEventListener('click',function(){renameLight(lightInfo);}); item.appendChild(nameBtn);

        var colorBtn=document.createElement('button'); colorBtn.type='button'; colorBtn.className='mp-btn small';
        colorBtn.style.cssText='min-height:38px;padding:0;border-radius:var(--radius-sm);border:1px solid var(--color-border);';
        colorBtn.addEventListener('click',function(){openQuickColorPicker(lightInfo,null);}); item.appendChild(colorBtn);

        var detailBtn=document.createElement('button'); detailBtn.type='button'; detailBtn.className='mp-btn small'; detailBtn.textContent='详情';
        detailBtn.style.cssText='min-height:38px;padding:5px;font-size:10px;font-weight:700;';
        detailBtn.addEventListener('click',function(){openLightDetailPage(lightInfo);}); item.appendChild(detailBtn);

        var deleteBtn=document.createElement('button'); deleteBtn.type='button'; deleteBtn.className='mp-btn danger small'; deleteBtn.textContent='删除';
        deleteBtn.style.cssText='min-height:38px;padding:5px;font-size:10px;font-weight:800;';
        deleteBtn.addEventListener('click',function(){if(window.confirm('确定删除“'+lightInfo.name+'”吗？'))deleteLight(lightInfo);}); item.appendChild(deleteBtn);

        lightInfo.uiElement=item; lightInfo.nameBtn=nameBtn; lightInfo.colorBtn=colorBtn; lightInfo.detailBtn=detailBtn; lightInfo.deleteBtn=deleteBtn;
        updateLightRowUI(lightInfo);
        listContainer.appendChild(item);
    }

    function updateLightRowUI(info){
        if(!info||!info.uiElement)return;
        if(info.nameBtn)info.nameBtn.textContent=(info.locked?'🔒 ':'')+info.name;
        if(info.colorBtn){var c=info.color||{r:1,g:1,b:1};info.colorBtn.style.background='rgb('+Math.round(c.r*255)+','+Math.round(c.g*255)+','+Math.round(c.b*255)+')';info.colorBtn.title='点击快速选色';}
        info.uiElement.style.opacity=info.enabled?'1':'0.48';
        if(info.locked) info.uiElement.style.borderLeft='3px solid var(--color-primary,#888)'; else info.uiElement.style.borderLeft='3px solid transparent';
    }

    function openLightDetailPage(lightInfo){
        if(!lightInfo||!container)return;

        // 详情页采用“页面替换”而不是绝对定位覆盖。
        // 这样不会因为宿主面板滚动容器/高度计算导致初次打开出现空白页。
        var previousChildren = Array.prototype.slice.call(container.children);

        var page=document.createElement('div');
        page.className='lm-detail-page';
        page.style.cssText='display:flex;flex-direction:column;gap:8px;flex:1;min-height:0;overflow-y:auto;padding:2px 0 8px;box-sizing:border-box;';

        function makeRow(){
            var row=document.createElement('div');
            row.style.cssText='background:var(--color-surface);border:1px solid var(--color-border);border-radius:var(--radius-md);padding:8px;box-sizing:border-box;';
            return row;
        }
        function makeLabel(text){
            var el=document.createElement('div');
            el.textContent=text;
            el.style.cssText='font-size:11px;color:var(--text-secondary);margin-bottom:5px;line-height:1.2;';
            return el;
        }
        function clamp(n,min,max){ return Math.max(min,Math.min(max,Number(n)||0)); }

        // 第一行：灯光名字 + 右侧移动
        var top=makeRow();
        top.style.cssText+='display:flex;align-items:center;gap:8px;min-height:40px;padding:6px 8px;';
        var title=document.createElement('div');
        title.textContent=(lightInfo.locked?'🔒 ':'')+lightInfo.name;
        lightInfo.detailTitleEl=title;
        title.style.cssText='font-size:15px;font-weight:700;color:var(--text-primary);flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;';
        top.appendChild(title);
        var moveBtn=document.createElement('button');
        moveBtn.className='mp-btn small'; moveBtn.type='button'; moveBtn.textContent='移动';
        moveBtn.style.cssText='min-width:48px;min-height:32px;padding:4px 8px;font-size:11px;';
        moveBtn.addEventListener('click',function(){
            toggleGizmo(lightInfo);
            moveBtn.textContent=currentGizmoLight===lightInfo?'完成':'移动';
        });
        top.appendChild(moveBtn);
        page.appendChild(top);
        lightInfo.gizmoBtn=moveBtn;

        // 第二行：颜色 + RGB + 7×5 快速选色 + HEX
        var colorRow=makeRow(); colorRow.appendChild(makeLabel('颜色'));
        var rgbGrid=document.createElement('div'); rgbGrid.style.cssText='display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:6px;';
        var rgbInputs={}, rgbSliders={}; var currentColor=lightInfo.color||{r:1,g:1,b:1};
        function rgbToHex(c){return '#'+[c.r,c.g,c.b].map(function(v){return Math.round(clamp(v,0,1)*255).toString(16).padStart(2,'0').toUpperCase();}).join('');}
        var preview; var hexInput;
        function updateColorPreview(c){if(preview)preview.style.background='rgb('+Math.round(c.r*255)+','+Math.round(c.g*255)+','+Math.round(c.b*255)+')';}
        function updateHex(c){if(hexInput)hexInput.value=rgbToHex(c);}
        function applyRGB(){
            var c={r:clamp(rgbInputs.r.value,0,255)/255,g:clamp(rgbInputs.g.value,0,255)/255,b:clamp(rgbInputs.b.value,0,255)/255};
            ['r','g','b'].forEach(function(ch){rgbInputs[ch].value=Math.round(c[ch]*255);rgbSliders[ch].value=rgbInputs[ch].value;});
            updateLightColor(lightInfo,c); updateLightRowUI(lightInfo); updateColorPreview(c); updateHex(c);
        }
        ['r','g','b'].forEach(function(ch){
            var cell=document.createElement('div'); cell.style.cssText='min-width:0;';
            var lab=document.createElement('div'); lab.textContent=ch.toUpperCase(); lab.style.cssText='font-size:10px;color:var(--text-secondary);margin-bottom:2px;text-align:center;'; cell.appendChild(lab);
            var input=document.createElement('input'); input.type='number'; input.min='0'; input.max='255'; input.step='1'; input.value=Math.round(clamp(currentColor[ch],0,1)*255); input.style.cssText='width:100%;box-sizing:border-box;min-height:30px;padding:3px 4px;text-align:center;background:var(--color-bg);color:var(--text-primary);border:1px solid var(--color-border);border-radius:var(--radius-sm);font-size:11px;'; cell.appendChild(input);
            var range=document.createElement('input'); range.type='range'; range.min='0'; range.max='255'; range.step='1'; range.value=input.value; range.style.cssText='width:100%;height:20px;margin:1px 0 0;'; cell.appendChild(range);
            rgbInputs[ch]=input; rgbSliders[ch]=range; input.addEventListener('input',applyRGB); input.addEventListener('change',applyRGB); range.addEventListener('input',function(){input.value=range.value;applyRGB();}); rgbGrid.appendChild(cell);
        });
        colorRow.appendChild(rgbGrid);
        var quickRow=document.createElement('div'); quickRow.style.cssText='display:grid;grid-template-columns:36px minmax(0,1fr) minmax(120px,1fr);gap:6px;align-items:center;margin-top:7px;';
        preview=document.createElement('button'); preview.type='button'; preview.className='mp-btn small'; preview.title='当前颜色预览'; preview.style.cssText='width:36px;height:32px;padding:0;border:1px solid var(--color-border);'; quickRow.appendChild(preview);
        var quickBtn=document.createElement('button'); quickBtn.type='button'; quickBtn.className='mp-btn small'; quickBtn.textContent='🎨 快速选色 7×5'; quickBtn.style.cssText='min-height:32px;font-size:11px;font-weight:700;'; quickBtn.addEventListener('click',function(){openQuickColorPicker(lightInfo,null);}); quickRow.appendChild(quickBtn);
        var hexWrap=document.createElement('div'); hexWrap.style.cssText='display:flex;align-items:center;gap:4px;'; var hexLabel=document.createElement('span'); hexLabel.textContent='HEX'; hexLabel.style.cssText='font-size:10px;color:var(--text-secondary);'; hexWrap.appendChild(hexLabel);
        hexInput=document.createElement('input'); hexInput.type='text'; hexInput.maxLength=7; hexInput.value=rgbToHex(currentColor); hexInput.style.cssText='width:100%;min-height:30px;box-sizing:border-box;padding:3px 5px;background:var(--color-bg);color:var(--text-primary);border:1px solid var(--color-border);border-radius:var(--radius-sm);font-size:11px;'; hexWrap.appendChild(hexInput); quickRow.appendChild(hexWrap);
        function applyHex(){var v=String(hexInput.value||'').trim();if(v.charAt(0)!=='#')v='#'+v;var m=/^#([0-9a-fA-F]{6})$/.exec(v);if(!m)return;var n=parseInt(m[1],16);var c={r:((n>>16)&255)/255,g:((n>>8)&255)/255,b:(n&255)/255};['r','g','b'].forEach(function(ch){rgbInputs[ch].value=Math.round(c[ch]*255);rgbSliders[ch].value=rgbInputs[ch].value;});updateLightColor(lightInfo,c);updateLightRowUI(lightInfo);updateColorPreview(c);hexInput.value=rgbToHex(c);}
        hexInput.addEventListener('change',applyHex); hexInput.addEventListener('blur',applyHex); colorRow.appendChild(quickRow); updateColorPreview(currentColor); page.appendChild(colorRow);

        // 第三行：XYZ，每列“数值输入 + 下方拖动条”
        var posRow=makeRow(); posRow.appendChild(makeLabel('XYZ 坐标'));
        var posGrid=document.createElement('div'); posGrid.style.cssText='display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px;align-items:start;';
        var posInputs={}, posSliders={};
        var p=lightInfo.light.position||{x:0,y:0,z:0};
        ['x','y','z'].forEach(function(axis){
            var cell=document.createElement('div'); cell.style.cssText='min-width:0;text-align:center;';
            var lab=document.createElement('div'); lab.textContent=axis.toUpperCase(); lab.style.cssText='font-size:10px;font-weight:700;color:var(--text-secondary);margin-bottom:3px;'; cell.appendChild(lab);
            var input=document.createElement('input'); input.type='number'; input.step='0.1'; input.value=(Number(p[axis])||0).toFixed(1);
            input.style.cssText='width:100%;box-sizing:border-box;min-height:31px;padding:3px 4px;text-align:center;background:var(--color-bg);color:var(--text-primary);border:1px solid var(--color-border);border-radius:var(--radius-sm);font-size:11px;'; cell.appendChild(input);
            var slider=document.createElement('input'); slider.type='range'; slider.min='-100'; slider.max='100'; slider.step='0.1'; slider.value=Number(p[axis])||0;
            slider.style.cssText='width:100%;height:20px;margin:1px 0 0;'; cell.appendChild(slider);
            posInputs[axis]=input; posSliders[axis]=slider;
            function applyPos(){
                var vals=[Number(posInputs.x.value)||0,Number(posInputs.y.value)||0,Number(posInputs.z.value)||0];
                posSliders.x.value=clamp(vals[0],-100,100); posSliders.y.value=clamp(vals[1],-100,100); posSliders.z.value=clamp(vals[2],-100,100);
                updateLightPosition(lightInfo,vals);
            }
            input.addEventListener('change',applyPos); input.addEventListener('input',applyPos);
            slider.addEventListener('input',function(){input.value=Number(slider.value).toFixed(1);applyPos();});
            posGrid.appendChild(cell);
        });
        page.appendChild(posRow); posRow.appendChild(posGrid);
        lightInfo.detailPosInputs=posInputs; lightInfo.detailPosSliders=posSliders;

        // 第四行：参数全部改为只读数值显示 + 拖动条。
        // UI 范围是安全、可操作的有限范围；不再允许输入框绕过范围写入异常值。
        var paramRow=makeRow(); paramRow.style.cssText+='padding:8px 10px;';
        var paramStack=document.createElement('div'); paramStack.style.cssText='display:flex;flex-direction:column;gap:9px;';
        function addNativeRange(label,value,min,max,step,onChange,format){
            var cell=document.createElement('div'); cell.style.cssText='display:grid;grid-template-columns:minmax(0,1fr) 86px;gap:8px;align-items:center;';
            var lab=document.createElement('div'); lab.textContent=label; lab.style.cssText='font-size:11px;color:var(--text-secondary);font-weight:600;'; cell.appendChild(lab);
            var valueEl=document.createElement('div'); valueEl.style.cssText='text-align:right;font-size:11px;font-weight:700;color:var(--text-primary);font-variant-numeric:tabular-nums;'; cell.appendChild(valueEl);
            var range=document.createElement('input'); range.type='range'; range.min=String(min); range.max=String(max); range.step=String(step);
            var initial=clamp(nativeNumber(value,min),min,max); range.value=String(initial); range.style.cssText='grid-column:1 / span 2;width:100%;height:20px;margin:0;'; cell.appendChild(range);
            function render(v){valueEl.textContent=format?format(v):String(v);}
            render(initial);
            range.addEventListener('input',function(){var v=Number(range.value);render(v);onChange(v);});
            paramStack.appendChild(cell);
            return {range:range,value:valueEl};
        }
        // 强度上限按灯光类型分档（参照 V1.2.3）：点光受 PBR 平方反比衰减影响最大，上限 300；
        // 聚光切回标准衰减后上限 30；方向光/环境光保持 3。不再一刀切压到 2。
        var intensityMax=getIntensityMax(lightInfo.type);
        var baseIntensity=clamp(nativeNumber(lightInfo.intensity,1),0,intensityMax);
        if (nativeNumber(lightInfo.intensity,1) !== baseIntensity) updateLightIntensity(lightInfo,baseIntensity);
        lightInfo.detailBrightness=addNativeRange('亮度',baseIntensity,0,intensityMax,0.01,function(v){updateLightIntensity(lightInfo,v);},function(v){return Number(v).toFixed(2);});
        if(lightInfo.type==='point'){
            var rawRange=getLightRange(lightInfo);
            // Babylon 的 Number.MAX_VALUE 是“无限远”默认哨兵值，不作为用户控件范围。
            if(!isFinite(rawRange)||rawRange>1000000){rawRange=100;try{lightInfo.light.range=rawRange;}catch(e){} lightInfo.range=rawRange;}
            lightInfo.detailRange=addNativeRange('光照范围',rawRange,0,100,0.1,function(v){applyLightArea(lightInfo,v);},function(v){return Number(v).toFixed(1);});
        }
        if(lightInfo.type==='spot'){
            var exponent=getSpotExponent(lightInfo);
            // exponent 取 Babylon 常用的可操作区间；过大的指数会造成数值失真/几乎无有效光照。
            exponent=clamp(nativeNumber(exponent,2),0,128);
            if(getSpotExponent(lightInfo)!==exponent) applyLightSoftness(lightInfo,exponent);
            lightInfo.detailSoftness=addNativeRange('虚化（exponent）',exponent,0,128,0.1,function(v){applyLightSoftness(lightInfo,v);},function(v){return Number(v).toFixed(1);});
            var angleDeg=clamp(degreesFromRadians(lightInfo.light.angle),1,90);
            if(degreesFromRadians(lightInfo.light.angle)!==angleDeg) applyLightArea(lightInfo,angleDeg);
            lightInfo.detailArea=addNativeRange('光照范围（angle）',angleDeg,1,90,1,function(v){applyLightArea(lightInfo,v);},function(v){return Math.round(v)+'°';});
            // SpotLight.range 在 Babylon 中默认是 Number.MAX_VALUE，属于无限远哨兵值。
            // 该参数对本插件没有可靠的有限 UI 语义，因此隐藏，不再显示或编辑。
            lightInfo.detailSpotRange=null;
        }
        paramRow.appendChild(paramStack); page.appendChild(paramRow);

        // 第五行：四个紧凑操作按钮
        var actions=document.createElement('div'); actions.style.cssText='display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:6px;';
        function actionBtn(text,fn,cls,disabled){var b=document.createElement('button');b.type='button';b.className='mp-btn small'+(cls?' '+cls:'');b.textContent=text;b.disabled=!!disabled;b.style.cssText='min-height:36px;padding:5px 6px;font-size:11px;font-weight:700;'+(disabled?'opacity:.45;cursor:not-allowed;':'');b.addEventListener('click',fn);actions.appendChild(b);return b;}
        var toggle=actionBtn(lightInfo.enabled?'关闭灯光':'开启灯光',function(){lightInfo.enabled=!lightInfo.enabled;applyGlobalLightEnabled();toggle.textContent=lightInfo.enabled?'关闭灯光':'开启灯光';updateLightRowUI(lightInfo);});
        var lock=actionBtn(lightInfo.locked?'解锁':'锁定灯光',function(){lightInfo.locked=!lightInfo.locked;if(lightInfo.light)lightInfo.light.__mikuplayLocked=lightInfo.locked;lock.textContent=lightInfo.locked?'解锁':'锁定灯光';title.textContent=(lightInfo.locked?'🔒 ':'')+lightInfo.name;updateLightRowUI(lightInfo);setDetailLocked(lightInfo.locked);if(!lightInfo.locked)applyLightScopeMode();});
        actionBtn('删除灯光',function(){if(window.confirm('确定删除“'+lightInfo.name+'”吗？')){deleteLight(lightInfo);closeDetail();}},'danger');
        page.appendChild(actions);

        // 阴影发生器设置区（从 V1.2.3 移植：开关 + 贴图大小 + 模糊 PCF；半球光自动显示不支持提示）
        page.appendChild(createShadowSection(lightInfo));

        var hint=document.createElement('div'); hint.textContent='锁定作用只阻止全局控制与灯光追踪器自动修改，不影响手动编辑。'; hint.style.cssText='font-size:10px;line-height:1.4;color:var(--text-secondary);padding:0 2px;'; page.appendChild(hint);

        function setDetailLocked(locked){page.querySelectorAll('input,select').forEach(function(el){el.disabled=!!locked;});page.querySelectorAll('button').forEach(function(el){if(el!==back&&el!==lock)el.disabled=!!locked;});moveBtn.disabled=!!locked;if(locked&&currentGizmoLight===lightInfo)toggleGizmo(lightInfo);page.style.opacity=locked?'0.72':'1';}

        function closeDetail(){
            if(page.parentNode) page.parentNode.removeChild(page);
            previousChildren.forEach(function(el){
                if (el === pageLightEl) el.style.display = pageLightElDisplay;
                else if (el === pageAnimEl) el.style.display = pageAnimElDisplay;
                else el.style.display = '';
            });
            if(container) container.scrollTop=0;
        }
        // 顶部标题行左侧增加返回按钮，但保持“第一行名字 + 右侧移动”的核心布局。
        var back=document.createElement('button'); back.type='button'; back.className='mp-btn small'; back.textContent='←'; back.title='返回灯光列表';
        back.style.cssText='position:absolute;left:0;top:0;min-width:34px;min-height:32px;padding:3px 6px;font-size:17px;';
        back.addEventListener('click',closeDetail);
        top.style.position='relative'; top.style.paddingLeft='44px'; top.insertBefore(back,top.firstChild);
        setDetailLocked(!!lightInfo.locked);

        // 详情页已完整构建后再切换显示，避免初始化异常导致整个面板白屏。
        previousChildren.forEach(function(el){ el.style.display='none'; });
        container.appendChild(page);
    }

    function updateLightUI(lightId){var info=lights.get(lightId);if(!info)return;updateLightRowUI(info);if(info.posInput){var p=info.light.position;try{info.posInput.setValue([p.x,p.y,p.z]);}catch(e){}}}

    /**
     * 切换Gizmo
     */
    function toggleGizmo(lightInfo) {
        if (!gizmoManager) return;

        // 如果当前已经有Gizmo附着在这个灯光上，则取消
        if (currentGizmoLight === lightInfo) {
            gizmoManager.attachToMesh(null);
            currentGizmoLight = null;
            lightInfo.gizmoBtn.textContent = '移动';
            lightInfo.gizmoBtn.classList.remove('primary');
            return;
        }

        // 取消之前的Gizmo
        if (currentGizmoLight) {
            currentGizmoLight.gizmoBtn.textContent = '移动';
            currentGizmoLight.gizmoBtn.classList.remove('primary');
        }

        // 附着到新灯光
        if (lightInfo.mesh) {
            gizmoManager.attachToMesh(lightInfo.mesh);
            currentGizmoLight = lightInfo;
            lightInfo.gizmoBtn.textContent = '完成';
            lightInfo.gizmoBtn.classList.add('primary');
        }
    }

    /**
     * 切换灯光可见性
     */
    function toggleLightVisibility(lightInfo, btn) {
        lightInfo.enabled = !lightInfo.enabled;
        lightInfo.light.setEnabled(lightInfo.enabled && globalLightEnabled);

        if (lightInfo.mesh) {
            lightInfo.mesh.setEnabled(lightInfo.enabled && lightInfo.meshVisible);
        }

        btn.textContent = lightInfo.enabled ? '关闭灯光' : '开启灯光';
        updateLightRowUI(lightInfo);
    }

    /**
     * 切换可视化网格可见性
     */
    function toggleMeshVisibility(lightInfo, btn) {
        if (!lightInfo.mesh) return;

        lightInfo.meshVisible = !lightInfo.meshVisible;
        lightInfo.mesh.setEnabled(lightInfo.enabled && lightInfo.meshVisible);

        btn.textContent = lightInfo.meshVisible ? '隐藏网格' : '显示网格';
    }

    /** HSL -> RGB，供快速选色面板使用。 */
    function hslToRgb(h, s, l) {
        h = ((h % 360) + 360) % 360 / 360;
        var r, g, b;
        if (s === 0) return { r:l, g:l, b:l };
        var q = l < 0.5 ? l * (1 + s) : l + s - l * s;
        var p = 2 * l - q;
        function hue2rgb(t) {
            if (t < 0) t += 1;
            if (t > 1) t -= 1;
            if (t < 1/6) return p + (q-p)*6*t;
            if (t < 1/2) return q;
            if (t < 2/3) return p + (q-p)*(2/3-t)*6;
            return p;
        }
        r = hue2rgb(h + 1/3); g = hue2rgb(h); b = hue2rgb(h - 1/3);
        return { r:r, g:g, b:b };
    }

    /**
     * 打开公共快速选色面板。所有灯光类型共用这一套颜色数据。
     */
    function openQuickColorPicker(lightInfo, colorPicker) {
        var overlay = document.createElement('div');
        overlay.style.cssText = 'position: fixed; inset: 0; z-index: 99999; background: rgba(0,0,0,.45); display:flex; align-items:center; justify-content:center; padding:16px;';
        var panel = document.createElement('div');
        panel.style.cssText = 'width:min(420px, 94vw); max-height:82vh; overflow:auto; background:var(--color-surface); color:var(--text-primary); border:1px solid var(--color-border); border-radius:12px; padding:14px; box-shadow:0 12px 36px rgba(0,0,0,.35);';

        var head = document.createElement('div');
        head.style.cssText = 'display:flex; align-items:center; justify-content:space-between; margin-bottom:10px;';
        var h = document.createElement('div');
        h.textContent = '快速选色';
        h.style.cssText = 'font-size:15px; font-weight:600;';
        head.appendChild(h);
        var close = document.createElement('button');
        close.className = 'mp-btn small'; close.textContent = '关闭';
        close.style.cssText = 'padding:4px 9px; font-size:11px;';
        close.addEventListener('click', function(){ if (overlay.parentNode) overlay.parentNode.removeChild(overlay); });
        head.appendChild(close); panel.appendChild(head);

        var hint = document.createElement('div');
        hint.textContent = '每行一种色相，从左到右由淡到浓；浓色更适合氛围灯。';
        hint.style.cssText = 'font-size:11px; color:var(--text-secondary); line-height:1.5; margin-bottom:10px;';
        panel.appendChild(hint);

        QUICK_COLOR_HUES.forEach(function(hue) {
            var row = document.createElement('div');
            row.style.cssText = 'display:grid; grid-template-columns:42px repeat(5,1fr); gap:6px; align-items:center; margin-bottom:7px;';
            var label = document.createElement('div');
            label.textContent = hue.name; label.style.cssText = 'font-size:11px; color:var(--text-secondary);';
            row.appendChild(label);
            QUICK_COLOR_LEVELS.forEach(function(level) {
                var c = hslToRgb(hue.h, level.s, level.l);
                var b = document.createElement('button');
                b.title = hue.name + ' · ' + level.name;
                b.style.cssText = 'height:32px; border-radius:7px; border:1px solid rgba(255,255,255,.20); cursor:pointer; background:rgb(' + Math.round(c.r*255) + ',' + Math.round(c.g*255) + ',' + Math.round(c.b*255) + ');';
                b.addEventListener('click', function() {
                    if (lightInfo) updateLightColor(lightInfo, c);
                    else if (colorPicker) {
                        try { if (typeof colorPicker.setValue === 'function') colorPicker.setValue(c); } catch(e) {}
                        // 即使颜色组件版本没有 setValue，也会通过下面的临时值在创建时读取。
                        colorPicker.__quickColor = c;
                    }
                    if (lightInfo && colorPicker) {
                        try { if (typeof colorPicker.setValue === 'function') colorPicker.setValue(c); } catch(e) {}
                    }
                    if (lightInfo && lightInfo.detailRgbSync) { try { lightInfo.detailRgbSync(c); } catch(e) {} }
                    if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
                });
                row.appendChild(b);
            });
            panel.appendChild(row);
        });

        overlay.addEventListener('click', function(e) { if (e.target === overlay && overlay.parentNode) overlay.parentNode.removeChild(overlay); });
        overlay.appendChild(panel);
        document.body.appendChild(overlay);
    }

    /**
     * 更新灯光颜色
     */
    function updateLightColor(lightInfo, color) {
        lightInfo.color = color;
        var col = new BABYLON.Color3(color.r, color.g, color.b);
        lightInfo.light.diffuse = col;
        if (lightInfo.type === 'hemispheric' && lightInfo.light.groundColor) {
            // 环境光的地面色保持较低比例，避免快速选色后整个场景阴影区被染得过重。
            lightInfo.light.groundColor = new BABYLON.Color3(color.r * 0.22, color.g * 0.22, color.b * 0.22);
        }

        if (lightInfo.mesh && lightInfo.mesh.material) {
            lightInfo.mesh.material.emissiveColor = col;
        }
    }

    /**
     * 更新灯光强度
     */
    function updateLightIntensity(lightInfo, intensity) {
        lightInfo.intensity = intensity;
        lightInfo.light.intensity = intensity * globalIntensityMultiplier;
    }

    /**
     * 更新聚光灯原生光锥角。UI 只做弧度/角度单位转换，不改变引擎参数语义。
     */
    function updateLightAngle(lightInfo, angleDeg) {
        if(!lightInfo || !lightInfo.light || lightInfo.type!=='spot') return;
        var rad=radiansFromDegrees(angleDeg);
        lightInfo.angle=rad;
        lightInfo.area=degreesFromRadians(rad);
        lightInfo.light.angle=rad;
    }

    /**
     * 更新灯光位置
     */
    function updateLightPosition(lightInfo, values) {
        var pos = new BABYLON.Vector3(values[0], values[1], values[2]);

        lightInfo.light.position = pos;

        if (lightInfo.mesh) {
            lightInfo.mesh.position = pos;
        }
    }

    /**
     * 该灯光是否支持阴影（半球光不支持）
     */
    function hasShadowSupport(lightInfo) {
        return lightInfo && lightInfo.type !== 'hemispheric';
    }

    /**
     * 创建灯光列表项中的"阴影"设置区域
     */
    function createShadowSection(lightInfo) {
        if (!hasShadowSupport(lightInfo)) {
            var noWrap = document.createElement('div');
            noWrap.style.cssText = 'border-top: 1px dashed var(--color-border); padding-top: 10px; margin-top: 4px;';
            var noTitle = document.createElement('div');
            noTitle.style.cssText = 'font-size: 12px; font-weight: 600; color: var(--text-secondary); margin-bottom: 6px;';
            noTitle.textContent = '阴影 (Shadow)';
            noWrap.appendChild(noTitle);
            var tip = document.createElement('div');
            tip.style.cssText = 'font-size: 11px; color: var(--text-disabled); line-height: 1.5;';
            tip.textContent = '半球光 (Hemispheric) 不支持阴影。';
            noWrap.appendChild(tip);
            return noWrap;
        }

        var wrapper = document.createElement('div');
        wrapper.className = 'light-shadow-section';
        wrapper.style.cssText = 'border-top: 1px dashed var(--color-border); padding-top: 10px; margin-top: 4px;';

        var title = document.createElement('div');
        title.style.cssText = 'font-size: 12px; font-weight: 600; color: var(--text-secondary); margin-bottom: 4px;';
        title.textContent = '阴影 (ShadowGenerator)';
        wrapper.appendChild(title);

        var toggle = new mp.ui.ToggleSwitch({
            label: '启用阴影发生器',
            initialState: !!lightInfo.shadowEnabled
        });
        toggle.onChange(function(enabled) {
            setShadowEnabled(lightInfo, enabled);
        });
        wrapper.appendChild(toggle.element);
        lightInfo.shadowToggle = toggle;

        // 高级设置（默认隐藏，启用阴影后显示）
        var advanced = document.createElement('div');
        advanced.style.cssText = 'margin-top: 10px; display: ' + (lightInfo.shadowEnabled ? 'block' : 'none') + ';';

        var sizeDropdown = new mp.ui.Dropdown({
            label: '阴影贴图大小',
            options: SHADOW_MAP_SIZES,
            selectedValue: String(lightInfo.shadowMapSize)
        });
        sizeDropdown.onChange(function(value) {
            lightInfo.shadowMapSize = parseInt(value, 10) || SHADOW_MAP_SIZE_DEFAULT;
            if (lightInfo.shadowEnabled) {
                recreateShadowGenerator(lightInfo);
            }
        });
        advanced.appendChild(sizeDropdown.element);

        var blurToggle = new mp.ui.ToggleSwitch({
            label: '模糊阴影 (PCF)',
            initialState: !!lightInfo.shadowBlur
        });
        blurToggle.onChange(function(enabled) {
            lightInfo.shadowBlur = !!enabled;
            if (lightInfo.shadowGenerator) {
                lightInfo.shadowGenerator.useBlurExponentialShadowMap = lightInfo.shadowBlur;
            }
        });
        advanced.appendChild(blurToggle.element);

        wrapper.appendChild(advanced);
        lightInfo.shadowAdvanced = advanced;

        return wrapper;
    }

    /**
     * 获取可作为阴影投射物的网格（优先模型根网格，其次场景网格，排除灯光可视化网格）
     */
    function rebuildShadowCasterCache() {
        if (!scene) return;
        var result=[]; var seen={};
        function add(mesh){
            if(!mesh||mesh.lightRef)return;
            var key=mesh.uniqueId!=null?String(mesh.uniqueId):null;
            if(key!==null){if(seen[key])return;seen[key]=true;}else if(result.indexOf(mesh)!==-1)return;
            result.push(mesh);
        }
        // 阴影投射物必须覆盖完整场景：人物、地面、舞台、背景、道具等均不能因模型桥过滤而丢失。
        (scene.meshes||[]).forEach(add);
        shadowCasterCache=result; shadowCasterCacheDirty=false;
    }

    function getShadowCasterMeshes() {
        if (shadowCasterCacheDirty) rebuildShadowCasterCache();
        return shadowCasterCache;
    }

    /**
     * 为阴影发生器注册投射物，并让场景网格与材质接收阴影
     */
    var shadowReceiverConfigured = false;
    var shadowReceiverCacheStamp = 0;
    var shadowCasterCacheVersion = 0;

    function addShadowCasters(sg) {
        if (!sg) return;

        var casters = getShadowCasterMeshes();
        for (var i = 0; i < casters.length; i++) {
            if (casters[i]) {
                try { sg.addShadowCaster(casters[i]); } catch (e) { /* 忽略单个网格失败 */ }
            }
        }

        var receivers = getShadowCasterMeshes();
        // cache 重建后重新配置新出现的 receiver；不再用一次性的全局 boolean 阻断后续模型/地面。
        if (!shadowReceiverConfigured || shadowReceiverCacheStamp !== shadowCasterCacheVersion) {
            for (var j = 0; j < receivers.length; j++) {
                var mesh = receivers[j];
                if (!mesh) continue;
                try {
                    mesh.receiveShadows = true;
                    if (mesh.material && typeof mesh.material.receiveShadows !== 'undefined') mesh.material.receiveShadows = true;
                } catch (e) {}
            }
            shadowReceiverConfigured = true;
            shadowReceiverCacheStamp = shadowCasterCacheVersion;
        }
    }

    /**
     * 创建阴影发生器
     */
    function createShadowGenerator(lightInfo) {
        if (!scene || !hasShadowSupport(lightInfo)) return null;
        if (lightInfo.shadowGenerator) return lightInfo.shadowGenerator;

        var mapSize = lightInfo.shadowMapSize || SHADOW_MAP_SIZE_DEFAULT;
        var sg = null;

        try {
            if (lightInfo.type === 'point' && typeof BABYLON.PointLightShadowGenerator !== 'undefined') {
                sg = new BABYLON.PointLightShadowGenerator(mapSize, lightInfo.light);
            } else if (typeof BABYLON.ShadowGenerator !== 'undefined') {
                sg = new BABYLON.ShadowGenerator(mapSize, lightInfo.light);
            }
        } catch (e) {
            console.error('[LightManager] 阴影发生器创建异常:', e);
            return null;
        }

        if (!sg) return null;

        if (lightInfo.shadowBlur) {
            sg.useBlurExponentialShadowMap = true;
            if (typeof sg.useKernelBlur !== 'undefined') {
                sg.useKernelBlur = true;
                sg.blurKernel = 32;
            }
        }

        addShadowCasters(sg);
        lightInfo.shadowGenerator = sg;
        return sg;
    }

    /**
     * 释放阴影发生器
     */
    function disposeShadowGenerator(lightInfo) {
        if (lightInfo.shadowGenerator) {
            try { lightInfo.shadowGenerator.dispose(); } catch (e) { /* 忽略 */ }
            lightInfo.shadowGenerator = null;
        }
    }

    /**
     * 按当前大小/模糊设置重建阴影发生器
     */
    function recreateShadowGenerator(lightInfo) {
        disposeShadowGenerator(lightInfo);
        createShadowGenerator(lightInfo);
    }

    /**
     * 开关灯光的阴影发生器
     */
    function setShadowEnabled(lightInfo, enabled) {
        enabled = !!enabled;
        lightInfo.shadowEnabled = enabled;

        if (enabled) {
            var sg = createShadowGenerator(lightInfo);
            if (!sg) {
                lightInfo.shadowEnabled = false;
                if (lightInfo.shadowToggle && typeof lightInfo.shadowToggle.setValue === 'function') {
                    try { lightInfo.shadowToggle.setValue(false); } catch (e) { /* 忽略 */ }
                }
                toast.error('阴影发生器创建失败，当前环境可能不支持阴影', 2500);
                if (lightInfo.shadowAdvanced) lightInfo.shadowAdvanced.style.display = 'none';
                return;
            }
            if (lightInfo.shadowAdvanced) lightInfo.shadowAdvanced.style.display = 'block';
        } else {
            disposeShadowGenerator(lightInfo);
            if (lightInfo.shadowAdvanced) lightInfo.shadowAdvanced.style.display = 'none';
        }
    }

    /**
     * 模型加载后刷新所有已启用阴影发生器的投射物
     */
    function refreshAllShadowCasters() {
        lights.forEach(function(info) {
            if (info.shadowEnabled && info.shadowGenerator) {
                addShadowCasters(info.shadowGenerator);
            }
        });
    }

    /**
     * 删除灯光
     */
    function deleteLight(lightInfo) {
        if (currentGizmoLight === lightInfo) {
            gizmoManager.attachToMesh(null);
            currentGizmoLight = null;
        }

        if (lightInfo.mesh) {
            lightInfo.mesh.material.dispose();
            lightInfo.mesh.dispose();
        }

        disposeShadowGenerator(lightInfo);
        try { delete lightInfo.light.__mikuplayLocked; delete lightInfo.light.__mikuplayScope; } catch(e) {}
        lightInfo.light.dispose();
        if (lightInfo.uiElement && lightInfo.uiElement.parentNode) lightInfo.uiElement.parentNode.removeChild(lightInfo.uiElement);
        lights.delete(lightInfo.id);
        removeLightFromAllGroups(lightInfo.id);
        materialCacheDirty = true;
        shadowCasterCacheDirty = true;
        shadowReceiverConfigured = false;
        shadowReceiverCacheStamp = 0;

        updateLightCount();
        if (lightScopeMode !== LIGHT_SCOPE_FREE) applyLightScopeMode();

        toast.info('灯光 "' + lightInfo.name + '" 已删除', 2000);
    }

    /**
     * 清空所有灯光
     */
    function clearAllLights() {
        lights.forEach(function(lightInfo) {
            if (lightInfo.mesh) {
                lightInfo.mesh.material.dispose();
                lightInfo.mesh.dispose();
            }
            disposeShadowGenerator(lightInfo);
            try { delete lightInfo.light.__mikuplayLocked; delete lightInfo.light.__mikuplayScope; } catch(e) {}
            lightInfo.light.dispose();
        });
        lights.clear();
        // V3：清空所有动画组（灯光已销毁，无需恢复效果）
        animGroups.forEach(function (g) {
            if (g.uiElement && g.uiElement.parentNode) g.uiElement.parentNode.removeChild(g.uiElement);
        });
        animGroups.clear();
        animSelectedLights = {};
        refreshGroupsUI();
        refreshAnimLightList();
        materialCacheDirty = true;
        shadowCasterCacheDirty = true;
        shadowReceiverConfigured = false;
        shadowReceiverCacheStamp = 0;

        var listContainer = container.querySelector('.light-list-container');
        if (listContainer) {
            listContainer.innerHTML = '';
        }
        updateLightCount();

        if (gizmoManager) {
            gizmoManager.attachToMesh(null);
            currentGizmoLight = null;
        }
    }

    /**
     * 更新灯光计数
     */
    function updateLightCount() {
        var listSection = container.querySelector('.light-list-section');
        if (listSection && listSection.titleCount) {
            listSection.titleCount.textContent = '(' + lights.size + ')';
        }
    }

    /**
     * 获取灯光类型标签
     */
    function getLightTypeLabel(type) {
        var found = LIGHT_TYPES.find(function(t) { return t.value === type; });
        return found ? found.label : type;
    }

    /**
     * 面板显示时调用
     */
export function onShown() {
        console.log('[LightManager] 面板已显示');
        // 面板显示时重新应用最大同时生效灯光数，确保新加载的材质也生效
        applyMaxSimultaneousLights(maxSimultaneousLights);
        refreshScopeTargetDropdown();
        applyLightScopeMode();
        refreshAnimLightList();
        refreshGroupsUI();
        refreshAnimTargetDropdown();
    };

    /**
     * 面板隐藏时调用
     */
export function onHidden() {
        // 隐藏时取消Gizmo
        if (gizmoManager) {
            gizmoManager.attachToMesh(null);
        }
        if (currentGizmoLight) {
            currentGizmoLight.gizmoBtn.textContent = '移动';
            currentGizmoLight.gizmoBtn.classList.remove('primary');
            currentGizmoLight = null;
        }
    };

    /**
     * 释放资源
     */
export function dispose() {
        // V3：停掉光动画帧循环并恢复各组效果
        animDisposed = true;
        if (animFrameObserver) {
            try { if (scene) scene.onBeforeRenderObservable.remove(animFrameObserver); } catch (e) {}
            animFrameObserver = null;
        }
        animGroups.forEach(function (g) {
            restoreGroupEffects(g);
            (g._comps || []).forEach(disposeComp);
            g._comps = [];
            if (g.uiElement && g.uiElement.parentNode) g.uiElement.parentNode.removeChild(g.uiElement);
        });
        animComponents.forEach(disposeComp);
        animComponents = [];
        disposeComp(animAddTargetDropdown);
        animGroups.clear();
        animSelectedLights = {};
        animLastTime = 0;
        globalAnimToggle = null;
        animLightListHost = null;
        animGroupsHost = null;
        animCountLabel = null;
        animAddTargetDropdown = null;
        animSelectAllBtn = null;
        animAddGroupBtn = null;

        // 取消所有事件订阅
        unsubscribers.forEach(function(unsub) { unsub(); });
        unsubscribers = [];

        // 清理Gizmo Observable，再释放GizmoManager
        gizmoObservers.forEach(function(entry) {
            try {
                if (entry && entry.observable && entry.observer) entry.observable.remove(entry.observer);
            } catch (e) {}
        });
        gizmoObservers = [];
        if (gizmoManager) {
            gizmoManager.dispose();
            gizmoManager = null;
        }

        // 清理所有灯光
        clearAllLights();

        container = null;
        scene = null;
        pluginContext = null;
        panelInitialized = false;
        materialCache = [];
        materialCacheDirty = true;
        shadowCasterCache = [];
        shadowCasterCacheDirty = true;
        shadowReceiverConfigured = false;
                shadowReceiverCacheStamp = 0;
        shadowCasterCacheVersion = 0;
        batchUpdateDepth = 0;
        pendingGlobalUpdate = false;
        pendingScopeUpdate = false;
        maxLightsSlider = null;
        userPresetDropdown = null;
        userPresetDesc = null;
    };


