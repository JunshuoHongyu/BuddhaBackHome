const {BasicScriptNode} = require('../BasicScriptNode');
const {
  customNode,
  component,
  input,
  output,
  serializeSceneObjectFlag,
  serializeProperty,
  label, readOnly, slider, spinBox, dropDown,
  textArea, header, showIf, tooltip, separator,
  space, groupBegin, groupEnd, disablePin,
} = require('../OrionDecorators');

"use strict";
/**
 * 《响堂山·心诚合十 佛首归来》—— 双手合十交互控制器
 *
 * 运行方式：像塑「脚本组件」，挂在实体「2D 相机」上。
 *
 * 交互规则：
 *   1. 未合十：显示 02 引导文案 / 03 合十金手 / 05 四角星光 / 11 石窟氛围 / 13 摄像头人像；
 *   2. 双手合十保持 0.6 秒：收起提示并**关闭 13 层人像（不再显示摄像头画面）**，
 *      20 秒主片（01 层 MP4 视频纹理）从头播放，整屏只展示特效影片；
 *      同时播放背景音乐（子物体「BgmPlayer」AudioComponent，playMode=INFINITE 循环），
 *      回到待机时停止；
 *      时间轴与结束判定以播放器真实状态为准（currentTime/loopCompleted），
 *      脚本累计时钟仅作 25s 兜底超时；
 *   3. 20 秒结束：定格特效画面约 3.5 秒，然后回到待机——此时才重新打开
 *      13 层实时人像，引导文案与金手再次出现，可再次合十重播。
 *
 * 手势数据：APJS.AlgorithmManager.getResult()
 *           → getHand2DCount() / getHand2DInfo(i).action
 *           → APJS.HandAction.Namaste / Pray / Beg 均视为合十。
 */
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var FoShouNamaste_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.FoShouNamaste = void 0;
let FoShouNamaste = FoShouNamaste_1 = class FoShouNamaste extends APJS.BasicScriptComponent {
    constructor() {
        super(...arguments);
        this.state = FoShouNamaste_1.IDLE;
        this.hold = 0;
        this.elapsed = 0;
        this.hintTime = 0;
        this.endTime = 0;
        this.ready = false;
        /** 触发一次后需要先松开手，才允许再次触发，避免手一直合十导致无限循环重播 */
        this.armed = true;
        this.releaseTime = 0;
        this.imgMain = null;
        this.imgGuide = null;
        this.imgBox = null;
        this.imgWheel = null;
        this.imgStar = null;
        this.imgFlash = null;
        this.imgHalo = null;
        this.imgTitle = null;
        this.imgSutra = null;
        this.imgBg = null;
        this.imgCam = null;
        /** 主片 Mp4TextureProvider 控制器（restartFilm 时缓存，供读取真实播放进度） */
        this.filmCtl = null;
        /** 背景音乐播放器组件（挂在子物体「BgmPlayer」上；playMode=INFINITE 由场景 DSL 设定） */
        this.bgm = null;
    }
    // ---- 生命周期 ---------------------------------------------------------------
    onStart() {
        this.log("onStart");
        this.bindLayers();
        this.enterIdle();
    }
    onUpdate(deltaTime) {
        if (!this.ready) {
            this.bindLayers();
            if (!this.ready)
                return;
            this.enterIdle();
        }
        let dt = deltaTime;
        if (!(dt > 0))
            dt = 0.016;
        if (dt > 0.1)
            dt = 0.1;
        // 手势识别逐帧会有抖动，这里对 hold 做迟滞：合十时累加，丢失时缓慢回退，
        // 短暂丢帧不会打断计时，只有真正松手才会归零。
        const gesture = this.detectNamaste();
        if (gesture) {
            this.hold += dt;
            this.releaseTime = 0;
        }
        else {
            this.hold = Math.max(0, this.hold - dt * 0.4);
            this.releaseTime += dt;
        }
        // 连续松手 0.4 秒后才重新武装，下一次合十才会再次触发
        if (this.releaseTime >= 0.4)
            this.armed = true;
        if (this.state === FoShouNamaste_1.IDLE) {
            this.hintTime += dt;
            const breath = 0.72 + 0.28 * (0.5 + 0.5 * Math.sin((this.hintTime * Math.PI * 2) / FoShouNamaste_1.HINT_CYCLE));
            this.show(this.imgGuide, true);
            this.show(this.imgBox, true);
            this.show(this.imgStar, true);
            this.show(this.imgBg, true);
            this.show(this.imgCam, true);
            this.show(this.imgMain, false);
            this.show(this.imgWheel, gesture);
            this.alpha(this.imgBg, FoShouNamaste_1.IDLE_BG_OPACITY);
            this.alpha(this.imgBox, gesture ? 1.0 : breath);
            this.alpha(this.imgGuide, gesture ? 1.0 : 0.86 + 0.14 * breath);
            if (this.armed && this.hold >= FoShouNamaste_1.HOLD_REQUIRED)
                this.startFilm();
            return;
        }
        if (this.state === FoShouNamaste_1.PLAYING) {
            this.elapsed += dt;
            // 时间轴优先用播放器自身时钟（引擎按真实 delta 累计，不受脚本 dt 截顶影响），
            // 播放器不可读时退回脚本累计时钟。
            let t = this.filmTime();
            if (!(t >= 0))
                t = this.elapsed;
            this.show(this.imgWheel, t < 1.2);
            this.show(this.imgFlash, t >= 0.9 && t < 1.35);
            this.show(this.imgSutra, t >= 4.0 && t < 8.5);
            this.show(this.imgHalo, t >= 12.5);
            this.show(this.imgTitle, t >= 12.5);
            // 触发后不再显示摄像头人像，整屏只有特效影片
            this.show(this.imgCam, false);
            // 结束判据：播放器真实状态（loop 完成或 currentTime 到 duration），
            // 兜底：累计时钟超过 DURATION_TIMEOUT（低帧率下 elapsed 慢于真实时间）。
            if (this.filmFinished() || this.elapsed >= FoShouNamaste_1.DURATION_TIMEOUT) {
                this.log("film end: " +
                    (this.filmFinished() ? "player state (currentTime/loop)" : "timeout fallback"));
                this.enterEnd();
            }
            return;
        }
        // 结尾定格：先停在特效画面上，短暂停留后回到待机，恢复实时人像
        this.endTime += dt;
        this.show(this.imgGuide, true);
        this.show(this.imgBox, true);
        this.show(this.imgCam, false);
        if (this.endTime >= FoShouNamaste_1.END_HOLD) {
            this.enterIdle();
            return;
        }
        if (this.armed && this.hold >= FoShouNamaste_1.HOLD_REQUIRED)
            this.startFilm();
    }
    onDestroy() {
        this.log("onDestroy");
    }
    // ---- 绑定 ------------------------------------------------------------------
    log(msg) {
        console.log("[FoShouNamaste] " + msg);
    }
    findLayer(name) {
        try {
            const scene = this.getSceneObject().scene;
            if (!scene || !scene.findSceneObject)
                return null;
            const obj = scene.findSceneObject(name);
            if (!obj)
                return null;
            let img = null;
            try {
                img = obj.getComponent("Image");
            }
            catch (e) {
                img = null;
            }
            if (!img) {
                try {
                    img = obj.getComponent("ImageRenderer");
                }
                catch (e) {
                    img = null;
                }
            }
            return img;
        }
        catch (e) {
            return null;
        }
    }
    bindLayers() {
        this.imgMain = this.findLayer(FoShouNamaste_1.N_MAIN);
        this.imgGuide = this.findLayer(FoShouNamaste_1.N_GUIDE);
        this.imgBox = this.findLayer(FoShouNamaste_1.N_BOX);
        this.imgWheel = this.findLayer(FoShouNamaste_1.N_WHEEL);
        this.imgStar = this.findLayer(FoShouNamaste_1.N_STAR);
        this.imgFlash = this.findLayer(FoShouNamaste_1.N_FLASH);
        this.imgHalo = this.findLayer(FoShouNamaste_1.N_HALO);
        this.imgTitle = this.findLayer(FoShouNamaste_1.N_TITLE);
        this.imgSutra = this.findLayer(FoShouNamaste_1.N_SUTRA);
        this.imgBg = this.findLayer(FoShouNamaste_1.N_BG);
        this.imgCam = this.findLayer(FoShouNamaste_1.N_CAM);
        this.bindAudio();
        this.ready = this.imgMain !== null;
        if (this.ready)
            this.log("layers bound");
        else
            this.log("main film layer NOT found: " + FoShouNamaste_1.N_MAIN);
    }
    /** 绑定背景音乐：子物体「BgmPlayer」上的 AudioComponent（场景已设 playMode=INFINITE、volume=70、autoPlay=false）。 */
    bindAudio() {
        try {
            const host = this.getSceneObject();
            const player = host.getChild ? host.getChild("BgmPlayer") : null;
            if (!player) {
                this.log("bgm: BgmPlayer child not found");
                this.bgm = null;
                return;
            }
            let ac = null;
            try {
                ac = player.getComponent("AudioComponent");
            }
            catch (e) {
                ac = null;
            }
            this.bgm = ac;
            if (this.bgm) {
                try {
                    this.bgm.volume = 70;
                }
                catch (e) { }
                this.log("bgm: AudioComponent bound (playMode=INFINITE, volume=70)");
            }
            else {
                this.log("bgm: AudioComponent NOT found on BgmPlayer");
            }
        }
        catch (e) {
            this.bgm = null;
            this.log("bindAudio failed: " + e);
        }
    }
    show(img, on) {
        if (!img)
            return;
        try {
            if (img.enabled === on)
                return;
        }
        catch (e) { }
        try {
            img.enabled = on;
        }
        catch (e) { }
    }
    alpha(img, v) {
        if (!img)
            return;
        try {
            if (img.opacity === v)
                return; // 值未变化时跳过，避免每帧触发引擎 dirty
            img.opacity = v;
        }
        catch (e) { }
    }
    // ---- 状态 ------------------------------------------------------------------
    enterIdle() {
        this.state = FoShouNamaste_1.IDLE;
        this.elapsed = 0;
        this.hold = 0;
        this.hintTime = 0;
        this.endTime = 0;
        this.armed = false;
        this.releaseTime = 0;
        this.show(this.imgGuide, true);
        this.show(this.imgBox, true);
        this.show(this.imgStar, true);
        this.show(this.imgBg, true);
        this.show(this.imgCam, true);
        this.show(this.imgMain, false);
        this.show(this.imgWheel, false);
        this.show(this.imgFlash, false);
        this.show(this.imgHalo, false);
        this.show(this.imgTitle, false);
        this.show(this.imgSutra, false);
        this.alpha(this.imgGuide, 1.0);
        this.alpha(this.imgBox, 1.0);
        this.alpha(this.imgBg, FoShouNamaste_1.IDLE_BG_OPACITY);
        this.alpha(this.imgCam, 1.0);
        this.stopBgm();
        this.log("state=idle (waiting for Namaste)");
    }
    startFilm() {
        this.state = FoShouNamaste_1.PLAYING;
        this.elapsed = 0;
        this.hold = 0;
        this.armed = false;
        // 合十一触发，立刻关闭摄像头人像层，之后只展示特效影片
        this.show(this.imgCam, false);
        this.show(this.imgGuide, false);
        this.show(this.imgBox, false);
        this.show(this.imgStar, false);
        this.show(this.imgBg, false);
        this.show(this.imgWheel, true);
        this.show(this.imgFlash, false);
        this.show(this.imgSutra, false);
        this.show(this.imgHalo, false);
        this.show(this.imgTitle, false);
        this.show(this.imgMain, true);
        this.alpha(this.imgMain, 1.0);
        this.restartFilm();
        this.playBgm();
        this.log("state -> playing (Namaste detected, camera portrait hidden)");
    }
    /** 播放背景音乐：仅当当前未处于播放中（isFinished 为真）才调用 play()，避免循环途中重复触发导致重头播放。 */
    playBgm() {
        if (!this.bgm) {
            this.log("[audio] missing channel=bgm");
            return;
        }
        try {
            if (this.bgm.isFinished) {
                this.bgm.play();
                this.log("[audio] action=play channel=bgm");
            }
        }
        catch (e) {
            this.log("[audio] play failed: " + e);
        }
    }
    /** 停止背景音乐（回到待机时调用）。stop 与下一帧的 play 不在同一帧，符合引擎调用约束。 */
    stopBgm() {
        if (!this.bgm)
            return;
        try {
            this.bgm.stop();
            this.log("[audio] action=stop channel=bgm");
        }
        catch (e) {
            this.log("[audio] stop failed: " + e);
        }
    }
    enterEnd() {
        this.state = FoShouNamaste_1.END;
        this.hold = 0;
        this.endTime = 0;
        this.show(this.imgWheel, false);
        this.show(this.imgFlash, false);
        this.show(this.imgSutra, false);
        this.show(this.imgGuide, true);
        this.show(this.imgBox, true);
        this.show(this.imgCam, false);
        this.log("state -> end (freeze, hint again, no camera)");
    }
    // ---- 20 秒主片播放（Mp4TextureProvider）-------------------------------------
    restartFilm() {
        const img = this.imgMain;
        if (!img)
            return;
        let ctl = null;
        try {
            const tex = img.texture;
            if (tex && tex.getControl)
                ctl = tex.getControl();
        }
        catch (e) {
            ctl = null;
        }
        this.filmCtl = ctl;
        if (!ctl) {
            this.log("film texture control not available");
            return;
        }
        try {
            if (ctl.loopCount !== undefined)
                ctl.loopCount = 1;
            if (ctl.stop)
                ctl.stop();
            if (ctl.play)
                ctl.play();
            this.log("film restarted from beginning");
        }
        catch (e) {
            this.log("restart film failed: " + e);
        }
    }
    /** 主片当前播放进度（秒）；读不到播放器状态时返回 -1。currentTime 单位为微秒。 */
    filmTime() {
        try {
            const c = this.filmCtl;
            if (c && typeof c.currentTime === "number" && c.currentTime > 0)
                return c.currentTime / 1e6;
        }
        catch (e) { }
        return -1;
    }
    /** 主片是否播完：优先 loopCompleted()，其次 currentTime 逼近 duration（50ms 容差）。 */
    filmFinished() {
        try {
            const c = this.filmCtl;
            if (!c)
                return false;
            if (c.loopCompleted && c.loopCompleted())
                return true;
            if (typeof c.currentTime === "number" && typeof c.duration === "number" && c.duration > 0) {
                return c.currentTime >= c.duration - 50000;
            }
        }
        catch (e) { }
        return false;
    }
    // ---- 手势判定 ---------------------------------------------------------------
    detectNamaste() {
        let result = null;
        try {
            result = APJS.AlgorithmManager.getResult();
        }
        catch (e) {
            result = null;
        }
        if (!result)
            return false;
        let count = 0;
        try {
            if (result.getHand2DCount)
                count = result.getHand2DCount();
            else if (result.getHandCount)
                count = result.getHandCount();
        }
        catch (e) {
            count = 0;
        }
        if (count <= 0)
            return false;
        for (let i = 0; i < count; i++) {
            let hand = null;
            try {
                hand = result.getHand2DInfo ? result.getHand2DInfo(i) : result.getHandInfo(i);
            }
            catch (e) {
                hand = null;
            }
            if (!hand)
                continue;
            const action = hand.action;
            if (action === APJS.HandAction.Namaste)
                return true;
            if (action === APJS.HandAction.Pray)
                return true;
            if (action === APJS.HandAction.Beg)
                return true;
        }
        return false;
    }
};
FoShouNamaste.IDLE = 0;
FoShouNamaste.PLAYING = 1;
FoShouNamaste.END = 2;
FoShouNamaste.HOLD_REQUIRED = 0.6;
/** 结尾定格时长，之后回到待机（重新显示实时人像，可再次拍摄） */
FoShouNamaste.END_HOLD = 3.5;
/**
 * 播放结束以播放器状态为准（Mp4TextureProvider.currentTime / loopCompleted）；
 * 本常量只是兜底超时：播放器异常读不到状态时，累计时钟到 25s 强制收尾。
 */
FoShouNamaste.DURATION_TIMEOUT = 25.0;
FoShouNamaste.IDLE_BG_OPACITY = 0.35;
FoShouNamaste.HINT_CYCLE = 2.4;
FoShouNamaste.N_MAIN = "01_主片_20秒序列帧";
FoShouNamaste.N_GUIDE = "02_引导文案_双手合十助佛首归来";
FoShouNamaste.N_BOX = "03_合十手势引导框";
FoShouNamaste.N_WHEEL = "04_识别金轮光爆";
FoShouNamaste.N_STAR = "05_四角星光";
FoShouNamaste.N_FLASH = "06_灵光乍现闪白";
FoShouNamaste.N_HALO = "07_佛首头光";
FoShouNamaste.N_TITLE = "08_结尾主标题_佛光金照殊胜圆满";
FoShouNamaste.N_SUTRA = "10_经文隧道叠加";
FoShouNamaste.N_BG = "11_静态背景_无头佛石窟";
/** 官方 Portrait Segmentation 抠像层（曾名「13_用户视频_前置摄像头全屏底图」，已更名） */
FoShouNamaste.N_CAM = "13_人像抠像层";
FoShouNamaste = FoShouNamaste_1 = __decorate([
    component()
], FoShouNamaste);
exports.FoShouNamaste = FoShouNamaste;
