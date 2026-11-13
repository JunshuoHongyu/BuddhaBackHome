/**
 * 【已废弃 / DEPRECATED — 请勿挂载或使用】
 * ---------------------------------------------------------------------------
 * 实际生效的交互控制器是 js/FoShouNamasteController.js（官方 JSScriptComponent，
 * 已挂在 Assets/main.scene 的「2D前景特效」实体上）。它实现了
 * 「没双手合十就一直提示，合十保持 0.8s 才启动 20 秒特效」。
 *
 * 本文件保留仅为历史参考：它从未挂到 Graph / JSScriptComponent，
 * 且早期版本含有像塑不存在的 API（findEntityByName / getAlgorithm /
 * getDetector / setCameraFacing 等）。不要把它粘贴进联动脚本编辑器，
 * 否则会与真正控制器争抢图层显隐。
 * 详见 Scripts/GraphBridge.js 与 Scripts/manifest.json 的 interaction 段。
 *
 * ---------------------------------------------------------------------------
 * 《响堂山·心诚合十 佛首归来》 20 秒 AR 互动控制器  v5（修复摄像头融合）
 * ---------------------------------------------------------------------------
 * 用途：像塑「联动脚本编辑器 / 用户脚本」参考实现。注意：本文件尚未挂到
 *      Graph 节点或 JSScriptComponent，工程开箱即用不依赖本脚本。
 *
 * v5 修复（v4 的摄像头方案是错的）：
 *   像塑 / 抖音端在用户选中特效时由「宿主」开启摄像头，特效不能也不需要
 *   用脚本打开摄像头。旧版调用的 setCameraFacing / switchCamera /
 *   getCameraTexture / getFrontCameraTexture / frontTexture 都不是像塑 API，
 *   全部无效；更糟的是 13 层当时绑的是一张不透明的静态占位 PNG，把摄像头
 *   画面完全盖住了 —— 这才是「没成功打开摄像头」的真正原因。
 *
 * 正确的官方做法（已写进 Assets/main.scene，无需脚本）：
 *   1. 13 层 ImageRenderer.texture = "share://input.texture"
 *      （官方内置相机输入纹理，固定 GUID 00000000-0000-0000-0000-00000000004b；
 *        Camera 的 .extra 同步写 cachedInputTexture）。
 *   2. 2D 相机 clearType=DEPTH，只清深度不清颜色，摄像头画面位于最底层。
 *   3. 01 主片默认 enabled=true、opacity=0.62 半透明叠加在实时人像上，
 *      打开特效即形成「用户视频 + 特效」的同一合成画面。
 *   4. 13 层是 720×1280 全屏 ScreenTransform、sortingOrder=0、全程常开，
 *      没有圆形裁剪、没有金框、没有画中画。
 *
 * 本脚本现在只负责：图层显隐 / 透明度、合十手势状态机、音效与重玩。
 * 交互规则：
 *   - 待机：全屏人像 + 半透明石窟氛围 + 0.35 主片 + 合十文案呼吸
 *   - 触发：双手合十持续 >= 0.8s；点击屏幕为兜底触发
 *   - 触发后：主片 0.35 → 0.62 淡入，播放 20s 主片 + 音轨，人像全程同屏
 *   - 20s 结束：停在「佛光金照 殊胜圆满」封面帧，允许点击重玩
 *
 * 想调融合强度：改 CFG.FUSION_OPACITY（或像塑里直接改 01 层 opacity）。
 *   - 调低 → 人像更明显
 *   - 调至 1.0 → 纯视频模式（人像被完全盖住）
 */

var Amaz = (typeof effect !== 'undefined') ? effect.Amaz : null;

var CFG = {
  DURATION: 20.0,            // 主片总时长（秒）
  HOLD_REQUIRED: 0.8,        // 合十需持续 0.8~1.0s（防误触）
  COOLDOWN: 0.35,
  HINT_CYCLE: 2.4,           // 待机引导框呼吸周期
  MIN_HAND_Y: 0.42,
  MAX_HAND_Y: 0.96,
  NAMASTE_SCORE: 0.60,       // 算法库置信度阈值

  // 官方内置相机输入纹理（宿主开启摄像头后持续输出实时画面）
  CAMERA_TEXTURE: 'share://input.texture',
  CAMERA_TEXTURE_GUID: '00000000-0000-0000-0000-00000000004b',
  CAMERA_FACING: 'FRONT',        // 前后置由宿主/拍摄端决定，脚本不切换
  FULLSCREEN: { x: 0, y: 0, w: 720, h: 1280 },  // ScreenTransform 参考画布

  FUSION_OPACITY: 0.62,      // ★ 01 主片半透明叠加强度
  FUSION_START_OPACITY: 0.35,// 触发瞬间起始透明度
  FUSION_FADE: 1.2,          // 1.2s 内淡入到 FUSION_OPACITY
  IDLE_BG_OPACITY: 0.35,     // 待机石窟氛围（不挡人像）
  USER_VIDEO_ALWAYS_ON: true // 摄像头层任何阶段都不关
};

var STATE = { IDLE: 'idle', PLAYING: 'playing', END: 'end' };

var NODES = {
  MAIN:  '01_主片_20秒序列帧',
  GUIDE: '02_引导文案_双手合十助佛首归来',
  BOX:   '03_合十手势引导框',
  WHEEL: '04_识别金轮光爆',
  STAR:  '05_四角星光',
  FLASH: '06_灵光乍现闪白',
  HALO:  '07_佛首头光',
  TITLE: '08_结尾主标题_佛光金照殊胜圆满',
  SUB:   '',
  SUTRA: '10_经文隧道叠加',
  BG:    '11_静态背景_无头佛石窟',
  REF:   '12_刻经洞实景参考',
  CAM:   '13_用户视频_前置摄像头全屏底图'   // ★ 全屏前置摄像头底图
};

var ALL_NAMES = Object.keys(NODES).map(function (k) { return NODES[k]; });

function FoShouGame() {
  this.state = STATE.IDLE;
  this.holdTime = 0;
  this.elapsed = 0;
  this.cooldown = 0;
  this.hintTime = 0;
  this.nodes = {};
  this.tracker = null;
  this.cameraLayerReady = false;   // 13 层相机底图是否已就位（不表示「打开摄像头」）
  this.sys = null;
}

/** 按名称缓存场景实体，兼容不同版本的取实体 API。 */
FoShouGame.prototype.bindNodes = function (scene) {
  var self = this;
  ALL_NAMES.forEach(function (n) {
    var e = null;
    if (scene && scene.findEntityByName) e = scene.findEntityByName(n);
    else if (Amaz && Amaz.Scene && Amaz.Scene.findEntityByName)
      e = Amaz.Scene.findEntityByName(n);
    if (e) self.nodes[n] = e;
  });
  return Object.keys(this.nodes).length;
};

FoShouGame.prototype.component = function (name) {
  var e = this.nodes[name];
  if (!e || !e.getComponent) return null;
  return e.getComponent('ImageRenderer') || e.getComponent('Image') || null;
};

/** 开关「图片组件」的渲染；像塑里等价于 enabled 勾选。 */
FoShouGame.prototype.setVisible = function (name, on) {
  var e = this.nodes[name];
  if (!e) return;
  if (e.setEnabled) e.setEnabled(on);
  var img = this.component(name);
  if (img && img.setEnabled) img.setEnabled(on);
  else if (img) img.enabled = on;
  if (e.selfvisible !== undefined) e.selfvisible = on;
};

FoShouGame.prototype.setOpacity = function (name, v) {
  var img = this.component(name);
  if (img) img.opacity = v;
};

/* -------------------------------------------------------------------------
 * 1) 摄像头画面：宿主提供，工程通过官方内置纹理引用
 * ---------------------------------------------------------------------- */
/**
 * 像塑没有「打开 / 切换摄像头」的脚本 API。用户选中特效时，宿主开启摄像头
 * 并把实时画面输出到 `share://input.texture`；本工程已在 Assets/main.scene
 * 把 13 层的 ImageRenderer.texture 绑定到它，2D 相机 clearType=DEPTH 保留
 * 摄像头透传，因此人像天然是合成画面的最底层。
 *
 * 本方法只做渲染层兜底：相机底图常开、完全不透明、位于最底层；主片默认
 * 可见（与场景默认值一致），避免脚本挂载后反而只剩人像、看不到特效。
 */
FoShouGame.prototype.ensureCameraLayer = function (sys) {
  sys = sys || this.sys || {};
  var img = this.component(NODES.CAM);
  this.cameraLayerReady = !!img;

  if (CFG.USER_VIDEO_ALWAYS_ON) {
    this.setVisible(NODES.CAM, true);
    this.setOpacity(NODES.CAM, 1.0);
  }
  if (img) {
    try {
      if (img.setSortingOrder) img.setSortingOrder(0);
      else img.sortingOrder = 0;   // 场景里已写死 sortingOrder=0，这里仅兜底
    } catch (e) { /* 不同版本组件表面不同，忽略 */ }
  }

  // 打开即融合：主片保持可见，待机用起始透明度，触发后淡入 0.62
  this.setVisible(NODES.MAIN, true);
  this.setOpacity(NODES.MAIN, CFG.FUSION_START_OPACITY);

  return this.cameraLayerReady;
};

/* -------------------------------------------------------------------------
 * 2) 身体跟踪 → 手部跟踪 → 双手合十：订阅算法库
 * ---------------------------------------------------------------------- */
/**
 * 节点库路径：可视化脚本 → 节点库 → AI 能力 →「身体跟踪」→「手部跟踪」
 *            →「双手合十」。（需求原文写"首部跟踪"，按合十语义取手部跟踪。）
 * 本方法返回 true 表示已拿到合十检测器；返回 false 时 readFrame() 会自动
 * 回退到 isNamaste() 用 21 点手部关键点自己算，功能不丢。
 */
FoShouGame.prototype.attachBodyTracker = function (sys) {
  var body = null, hand = null, namaste = null;
  try {
    if (sys && sys.getAlgorithm)
      body = sys.getAlgorithm('BodyTrack') || sys.getAlgorithm('body_track') ||
             sys.getAlgorithm('身体跟踪');
    else if (Amaz && Amaz.Algorithm && Amaz.Algorithm.get)
      body = Amaz.Algorithm.get('BodyTrack');
  } catch (e) { body = null; }

  if (body) {
    try {
      if (body.getSubModule)
        hand = body.getSubModule('HandTrack') || body.getSubModule('hand') ||
               body.getSubModule('手部跟踪');
      else if (body.hand) hand = body.hand;
      else hand = body;                       // 有些版本身体跟踪直接吐手部点
    } catch (e) { hand = body; }
  }
  if (hand) {
    try {
      if (hand.getDetector)
        namaste = hand.getDetector('Namaste') || hand.getDetector('namaste') ||
                  hand.getDetector('双手合十');
      else if (hand.namaste) namaste = hand.namaste;
    } catch (e) { namaste = null; }
  }
  this.tracker = { body: body, hand: hand, namaste: namaste };
  return !!namaste;
};

/** 把每帧的算法输出统一成 {hands, namaste, confidence, tapped, depthOK}。 */
FoShouGame.prototype.readFrame = function (sys, frame) {
  // 兼容旧签名 onUpdate(dt, hands, tapped, depthOK)
  if (Array.isArray(frame)) frame = { hands: frame };
  frame = frame || {};
  var out = {
    hands: frame.hands || null,
    tapped: !!frame.tapped,
    depthOK: frame.depthOK !== false,
    namaste: false,
    confidence: 0
  };

  var t = this.tracker;
  if (t) {
    try {
      if (t.hand && t.hand.getHandKeypoints && !out.hands)
        out.hands = t.hand.getHandKeypoints(sys);
      if (t.namaste) {
        var r = (typeof t.namaste === 'function') ? t.namaste(sys) :
                (t.namaste.getValue ? t.namaste.getValue(sys) :
                 (t.namaste.value !== undefined ? t.namaste.value : t.namaste));
        if (typeof r === 'boolean') { out.namaste = r; out.confidence = r ? 1 : 0; }
        else if (typeof r === 'number') {
          out.confidence = r; out.namaste = r >= CFG.NAMASTE_SCORE;
        } else if (r && typeof r === 'object') {
          out.confidence = r.confidence !== undefined ? r.confidence : (r.score || 0);
          out.namaste = !!(r.matched || r.detected ||
                           out.confidence >= CFG.NAMASTE_SCORE);
        }
      }
    } catch (e) { /* 算法未就绪：走关键点兜底 */ }
  }

  if (frame.namaste !== undefined) out.namaste = !!frame.namaste;
  if (frame.confidence !== undefined) out.confidence = frame.confidence;
  // 兜底：库没给结果时，用 21 点关键点自行判定
  if (!out.namaste && out.hands) {
    out.namaste = this.isNamaste(out.hands);
    if (out.namaste) out.confidence = Math.max(out.confidence, 0.75);
  }
  return out;
};

/** 双手合十判定：两掌接近、位于屏幕中下部、指尖朝上。 */
FoShouGame.prototype.isNamaste = function (hands) {
  if (!hands || hands.length < 2) return false;
  var l = hands[0], r = hands[1];
  var lw = l[0], rw = r[0];                  // 0=腕，12=中指尖
  if (!lw || !rw) return false;
  var midX = (lw.x + rw.x) * 0.5;
  var midY = (lw.y + rw.y) * 0.5;
  if (midY < CFG.MIN_HAND_Y || midY > CFG.MAX_HAND_Y) return false;
  if (Math.abs(lw.x - rw.x) > 0.30) return false;
  var lTip = l[12] || l[8], rTip = r[12] || r[8];
  if (!lTip || !rTip) return false;
  if (lTip.y > midY || rTip.y > midY) return false;
  if (Math.abs(lTip.x - rTip.x) > 0.16) return false;
  return true;
};

/* -------------------------------------------------------------------------
 * 3) 状态机
 * ---------------------------------------------------------------------- */
FoShouGame.prototype.playAudio = function () {
  if (Amaz && Amaz.Audio && Amaz.Audio.play) Amaz.Audio.play('bgm_20s');
};

/** 初始化：绑实体 → 确认相机底图就位 → 身体跟踪库 → 进入互动待机。 */
FoShouGame.prototype.init = function (scene, sys) {
  this.sys = sys || {};
  this.bindNodes(scene);
  this.ensureCameraLayer(sys);       // 只校验图层，不「打开」摄像头
  this.attachBodyTracker(sys);
  this.reset();
  return this;
};

FoShouGame.prototype.start = function () {
  if (this.state === STATE.PLAYING) return;
  this.state = STATE.PLAYING;
  this.elapsed = 0;
  this.holdTime = 0;

  // 关待机氛围背景；引导文案 / 框 / 星光一并收起，避免与主片重影
  this.setVisible(NODES.BG, false);
  [NODES.GUIDE, NODES.BOX, NODES.STAR].forEach(function (n) {
    this.setVisible(n, false);
  }, this);

  // 开 20s 主片：以半透明叠加在全屏摄像头人像之上
  this.setVisible(NODES.MAIN, true);
  this.setOpacity(NODES.MAIN, CFG.FUSION_START_OPACITY);
  var main = this.nodes[NODES.MAIN];
  if (main && main.getComponent) {
    var anim = main.getComponent('AnimSequence') || this.component(NODES.MAIN);
    if (anim && anim.play) anim.play(0, 1);
    if (anim && anim.setCurrentFrame) anim.setCurrentFrame(0);
  }

  // ★ 摄像头底图全程不关：用户人像持续与特效处于同一画面
  if (CFG.USER_VIDEO_ALWAYS_ON) {
    this.setVisible(NODES.CAM, true);
    this.setOpacity(NODES.CAM, 1.0);
  }
  this.playAudio();
};

FoShouGame.prototype.reset = function () {
  this.state = STATE.IDLE;
  this.elapsed = 0;
  this.holdTime = 0;

  // 互动待机：全屏人像 + 半透明石窟氛围 + 半透明主片 + 合十引导
  // 主片保持可见（与场景默认值一致），打开特效即形成融合画面
  this.setVisible(NODES.MAIN, true);
  [NODES.WHEEL, NODES.FLASH, NODES.SUTRA, NODES.HALO,
   NODES.TITLE, NODES.SUB, NODES.REF]
    .forEach(function (n) { this.setVisible(n, false); }, this);
  this.setVisible(NODES.GUIDE, true);
  this.setVisible(NODES.BOX, true);
  this.setVisible(NODES.STAR, true);
  this.setVisible(NODES.BG, true);
  this.setOpacity(NODES.BG, CFG.IDLE_BG_OPACITY);
  this.setVisible(NODES.CAM, true);
  this.setOpacity(NODES.CAM, 1.0);
  this.setOpacity(NODES.MAIN, CFG.FUSION_START_OPACITY);
};

/**
 * 每帧调用。frame 推荐由可视化脚本传入：
 *   { hands, tapped, depthOK, namaste, confidence }
 * 其中 namaste / confidence 来自「身体跟踪 → 手部跟踪 → 双手合十」节点；
 * 不传也能用（readFrame 会向订阅的算法库取，或用手部关键点兜底）。
 */
FoShouGame.prototype.onUpdate = function (dt, frame, sys) {
  dt = Math.min(dt || 0, 0.1);
  if (sys) this.sys = sys;
  if (this.cooldown > 0) this.cooldown -= dt;

  var f = this.readFrame(this.sys, frame);

  if (this.state === STATE.IDLE) {
    // 待机：合十引导框 2.4s 周期呼吸，引导用户看全屏人像并做合十
    this.hintTime += dt;
    var breath = 0.72 + 0.28 * (0.5 + 0.5 *
                  Math.sin(this.hintTime * Math.PI * 2 / CFG.HINT_CYCLE));
    this.setOpacity(NODES.BOX, breath);
    this.setOpacity(NODES.GUIDE, 0.86 + 0.14 * breath);

    this.holdTime = (f.namaste && f.depthOK) ? this.holdTime + dt : 0;
    if ((this.holdTime >= CFG.HOLD_REQUIRED || f.tapped) && this.cooldown <= 0) {
      this.cooldown = CFG.COOLDOWN;
      this.start();
    }
    return;
  }

  if (this.state === STATE.PLAYING) {
    this.elapsed += dt;
    var t = this.elapsed;

    this.setVisible(NODES.WHEEL, t < 1.2);
    this.setVisible(NODES.FLASH, t >= 0.9 && t < 1.35);
    this.setVisible(NODES.SUTRA, t >= 4.0 && t < 8.5);
    this.setVisible(NODES.HALO, t >= 12.5);
    this.setVisible(NODES.TITLE, t >= 12.5);
    this.setVisible(NODES.SUB, t >= 12.5);

    // 融合淡入：主片 0.35 → 0.62，用户被金光「卷入」特效，人像始终在底层
    if (CFG.USER_VIDEO_ALWAYS_ON) {
      var k = Math.min(1, t / CFG.FUSION_FADE);
      this.setOpacity(NODES.MAIN,
        CFG.FUSION_START_OPACITY +
        (CFG.FUSION_OPACITY - CFG.FUSION_START_OPACITY) * k);
      this.setVisible(NODES.CAM, true);
      this.setOpacity(NODES.CAM, 1.0);
    }

    if (t >= CFG.DURATION) {
      this.state = STATE.END;
      this.elapsed = CFG.DURATION;
      [NODES.WHEEL, NODES.FLASH, NODES.SUTRA].forEach(function (n) {
        this.setVisible(n, false);
      }, this);
      // 定格：主片停末帧、标题保持、摄像头人像继续同屏
    }
    return;
  }

  // END：点击重玩，回到互动待机（前置摄像头不重启，避免黑帧）
  if (f.tapped && this.cooldown <= 0) {
    this.cooldown = CFG.COOLDOWN;
    this.reset();
  }
};

/** 调试用：返回当前合成状态。 */
FoShouGame.prototype.compositeState = function () {
  return {
    state: this.state,
    elapsed: +this.elapsed.toFixed(3),
    cameraFacing: CFG.CAMERA_FACING,
    cameraOpenedByHost: true,
    cameraTexture: CFG.CAMERA_TEXTURE,
    cameraTextureGuid: CFG.CAMERA_TEXTURE_GUID,
    cameraLayerReady: this.cameraLayerReady,
    cameraLayer: NODES.CAM,
    cameraFullscreen: CFG.FULLSCREEN,
    mainFilmEnabledDefault: true,
    trackerPath: '身体跟踪 → 手部跟踪 → 双手合十',
    trackerReady: !!(this.tracker && this.tracker.namaste),
    userVideoVisible: CFG.USER_VIDEO_ALWAYS_ON,
    fusionMode: 'fullscreen_front_camera_alpha_blend',
    mainFilmOpacity: CFG.FUSION_OPACITY,
    idleBackgroundOpacity: CFG.IDLE_BG_OPACITY,
    pictureInPicture: false,
    circleMask: false,
    goldFrame: false,
    pureFilmMode: '把 01 层 opacity 调到 1.0'
  };
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    FoShouGame: FoShouGame, CFG: CFG, STATE: STATE, NODES: NODES
  };
}
