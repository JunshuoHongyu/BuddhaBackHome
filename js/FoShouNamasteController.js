/**
 * 《响堂山·心诚合十 佛首归来》—— 双手合十交互控制器
 * ---------------------------------------------------------------------------
 * 挂载位置（官方 JSScriptComponent 机制）：
 *   Assets/main.scene → 实体「2D前景特效」→ JSScriptComponent
 *   path: js/FoShouNamasteController.js
 *
 * 交互规则（本次需求）：
 *   1. 用户没有双手合十 → 特效不开始，02 引导文案 / 03 合十手势引导框
 *      全程常驻并做呼吸动画，持续提示用户。
 *   2. 检测到双手合十并持续 0.8 秒 → 收起提示，启动 20 秒主片，
 *      摄像头人像（13 层）全程同屏，主片半透明叠加。
 *   3. 20 秒结束 → 定格结尾，引导文案再次出现，再次合十可重播。
 *   4. 默认不允许「点击屏幕代替合十」（ALLOW_TAP_FALLBACK=false），
 *      严格满足「没合十就一直提示」。
 *
 * 官方手势能力（来自安装目录 BuiltinResource）：
 *   - 可视化脚本节点「Gesture Detection」(GUID 67144819-16ad-b75d-18d3-0b965c0bafdb)
 *     的 "Touching Palms" 即 APJS.HandAction.Namaste / Amaz.HandAction.NAMASTE。
 *     该节点已在 Graph/graph.json 中声明，用于让工程启用 2handGestureDetect 算法。
 *   - 每帧算法结果：APJS.AlgorithmManager.getResult() 或
 *     Amaz.AmazingManager.getSingleton('Algorithm').getAEAlgorithmResult()，
 *     通过 getHandCount()/getHandInfo(i).action 读取。
 *   - 关键点点位：0=腕，8=食指指尖，12=中指指尖，21=掌心；归一化坐标，
 *     y 轴向下。算法分类不可用时用两掌关键点做兜底判定。
 *
 * 不使用任何「打开摄像头 / 切换前后置」的脚本 API：摄像头由宿主在选中特效时
 * 开启，13 层绑定官方内置相机输入纹理 share://input.texture 即可。
 */

var Amaz = (typeof effect !== 'undefined' && effect.Amaz) ? effect.Amaz : null;

var CFG = {
  DURATION: 20.0,              // 20 秒主片
  HOLD_REQUIRED: 0.8,          // 合十需保持 0.8 秒，防误触
  LOSE_GRACE: 1.5,             // 偶发丢帧时的容错衰减速度
  HINT_CYCLE: 2.4,             // 待机提示呼吸周期（秒）
  FUSION_START_OPACITY: 0.35,  // 触发瞬间主片透明度
  FUSION_OPACITY: 0.62,        // 1.2 秒后淡入到的人像融合强度
  FUSION_FADE: 1.2,
  IDLE_BG_OPACITY: 0.35,
  ACCEPT_SIMILAR: true,        // 兼容 Beg(作揖)/Pray(祈祷) 等合掌类手势
  ALLOW_TAP_FALLBACK: false,   // ★ 严格模式：点屏不能代替合十
  SUTRA_SPIN: 1.1,             // 经文隧道旋转角速度 rad/s（漩涡 + 中心经文字作为同一单位一起转）
  BGM_NAME: 'bgm_namaste',     // 全局播放接口 Amaz.Audio.play() 的兜底资源名（优先用组件对象 play()）
  BGM_VOL: 70,                 // 背景音乐音量（与场景 AudioComponent.serializedVolume 保持一致）
  DEBUG_LOG: true
};

var L = {
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
  CAM:   '13_用户视频_前置摄像头全屏底图'
};

var KEYS = ['MAIN', 'GUIDE', 'BOX', 'WHEEL', 'STAR', 'FLASH', 'HALO',
            'TITLE', 'SUB', 'SUTRA', 'BG', 'REF', 'CAM'];

var STATE = { IDLE: 'idle', PLAYING: 'playing', END: 'end' };

function FoShouNamasteController() {
  this.state = STATE.IDLE;
  this.elapsed = 0;
  this.hold = 0;
  this.hintTime = 0;
  this.entities = {};
  this.comps = {};
  this.bound = false;
  this.algorithmSource = 'none';
  this.loggedSource = false;
  this.apjsRef = null;
  this.acceptedActions = null;
  this.acceptedComplete = false;
  this.disabled = false;       // 已有同类控制器时置 true，避免双重控制
  this.fromGraph = false;      // 是否由可视化脚本节点兜底启动
  this.sutraAngle = 0;         // 经文隧道累计旋转角（rad），由脚本驱动，保证漩涡与中心字同转
  this.bgm = null;             // 背景音乐 AudioComponent 缓存（来自实体 BgmPlayer）
  this.bgmBound = false;       // 是否已尝试绑定 BgmPlayer
}

FoShouNamasteController.prototype.log = function (msg) {
  if (!CFG.DEBUG_LOG) return;
  try {
    if (Amaz && Amaz.LOGI) Amaz.LOGI('FoShouNamaste', msg);
    else if (typeof console !== 'undefined') console.log('[FoShouNamaste] ' + msg);
  } catch (e) { /* 日志不影响运行 */ }
};

/* -------------------------------------------------------------------------
 * 场景对象绑定：兼容新旧两代 Scene API
 * ---------------------------------------------------------------------- */
FoShouNamasteController.prototype.findObject = function (name) {
  var scene = this.scene || null;
  var o = null;
  try {
    if (scene && scene.findSceneObject) o = scene.findSceneObject(name);
    if (!o && scene && scene.findEntityByName) o = scene.findEntityByName(name);
  } catch (e) { o = null; }
  if (o) return o;

  // 兜底：遍历全部场景对象按名称匹配
  var list = null;
  try {
    if (scene && scene.getAllSceneObjects) list = scene.getAllSceneObjects();
    else if (scene && scene.getRootSceneObjects) {
      list = [];
      var stack = scene.getRootSceneObjects().slice();
      while (stack.length) {
        var cur = stack.pop();
        if (!cur) continue;
        list.push(cur);
        var ch = cur.getChildren ? cur.getChildren() : [];
        for (var c = 0; c < ch.length; c++) stack.push(ch[c]);
      }
    }
  } catch (e) { list = null; }
  if (list) {
    for (var i = 0; i < list.length; i++) {
      var obj = list[i];
      if (!obj) continue;
      var nm = obj.name;
      if (!nm && obj.getName) nm = obj.getName();
      if (nm === name) return obj;
    }
  }
  return null;
};

FoShouNamasteController.prototype.imageOf = function (obj) {
  if (!obj || !obj.getComponent) return null;
  var img = null;
  try { img = obj.getComponent('ImageRenderer') || obj.getComponent('Image'); }
  catch (e) { img = null; }
  return img || null;
};

FoShouNamasteController.prototype.bindLayers = function () {
  var found = 0;
  for (var i = 0; i < KEYS.length; i++) {
    var k = KEYS[i];
    var obj = this.findObject(L[k]);
    var img = this.imageOf(obj);
    // 同时用「键」和「场景里的中文实体名」做索引，调用方两种写法都能命中
    this.entities[k] = obj;
    this.entities[L[k]] = obj;
    this.comps[k] = img;
    this.comps[L[k]] = img;
    if (obj) found++;
  }
  this.bound = found > 0;
  this.log('layers bound ' + found + '/' + KEYS.length);
  return found;
};

FoShouNamasteController.prototype.setVisible = function (key, on) {
  var obj = this.entities[key];
  if (!obj) return;
  var img = this.comps[key];
  if (img) {
    try { img.enabled = !!on; return; } catch (e) { /* 落到实体显隐 */ }
  }
  try {
    if (obj.setEnabledInHierarchy) obj.setEnabledInHierarchy(!!on);
    else if (obj.enabled !== undefined) obj.enabled = !!on;
  } catch (e) { /* 忽略 */ }
};

FoShouNamasteController.prototype.setOpacity = function (key, v) {
  var img = this.comps[key];
  if (!img) return;
  try { img.opacity = v; } catch (e) { /* 忽略 */ }
};

/* -------------------------------------------------------------------------
 * 背景音乐：场景实体「BgmPlayer」挂了 AudioComponent（audioType=Bgm，
 * playMode=Infinity 循环，autoPlay=false），资源为 Assets/bgm_namaste.mp3。
 * 因为 autoPlay=false 且此前实际挂载的控制器从未调用 play()，所以预览不响。
 * 这里在合十触发主片时 bindAudio() 取组件并 playBgm()；回待机 stopBgm()。
 * 兼容像塑 / 抖音特效引擎 AudioComponent 实例 API：play()/resume()/stop()/pause()，
 * 并加 isPlaying 守卫，避免循环播放途中被重复 play 造成叠音。
 * ---------------------------------------------------------------------- */
FoShouNamasteController.prototype.bindAudio = function () {
  if (this.bgmBound) return this.bgm;
  this.bgmBound = true;
  var host = this.findObject('BgmPlayer');
  if (!host) { this.log('BGM: BgmPlayer entity not found'); return null; }
  var comp = null;
  try {
    comp = host.getComponent('AudioComponent') ||
           host.getComponent('AudioSource') ||
           host.getComponent('Sound') || null;
  } catch (e) { comp = null; }
  if (!comp) {
    // 极少数结构下音频组件挂在 BgmPlayer 的父实体上
    var parent = null;
    try { parent = host.getParent ? host.getParent() : (host.parent || null); } catch (e) { parent = null; }
    if (parent) {
      try { comp = parent.getComponent('AudioComponent') || null; } catch (e) { comp = null; }
    }
  }
  this.bgm = comp;
  if (!comp) this.log('BGM: AudioComponent missing (autoPlay=false 且无脚本接管)');
  else this.log('BGM: AudioComponent bound ok');
  return comp;
};

FoShouNamasteController.prototype.playBgm = function () {
  var bgm = this.bgm || this.bindAudio();
  if (!bgm) {
    // 兜底：全局音频接口（资源名以文件名基名传入；组件路径优先，此处仅最后尝试）
    try {
      if (Amaz && Amaz.Audio && Amaz.Audio.play) {
        Amaz.Audio.play(CFG.BGM_NAME);
        this.log('BGM: played via Amaz.Audio.play(' + CFG.BGM_NAME + ')');
      }
    } catch (e) { this.log('BGM: no playable component (' + e + ')'); }
    return;
  }
  // isPlaying 守卫：循环播放途中不重播，避免叠音
  var playing = false;
  try {
    if (typeof bgm.isPlaying === 'function') playing = !!bgm.isPlaying();
    else if (bgm.isPlaying !== undefined) playing = !!bgm.isPlaying;
  } catch (e) { playing = false; }
  if (playing) return;
  try {
    if (typeof bgm.setVolume === 'function' && CFG.BGM_VOL != null) {
      try { bgm.setVolume(CFG.BGM_VOL); } catch (e) { /* 忽略 */ }
    }
    if (typeof bgm.play === 'function') { bgm.play(); this.log('BGM: play()'); return; }
    if (typeof bgm.resume === 'function') { bgm.resume(); this.log('BGM: resume()'); return; }
  } catch (e) { this.log('BGM: play failed (' + e + ')'); }
};

FoShouNamasteController.prototype.stopBgm = function () {
  var bgm = this.bgm;
  if (!bgm) return;
  try {
    if (typeof bgm.stop === 'function') bgm.stop();
    else if (typeof bgm.pause === 'function') bgm.pause();
    this.log('BGM: stop()');
  } catch (e) { /* 停止失败不影响主流程 */ }
};

/* -------------------------------------------------------------------------
 * 经文隧道旋转：让整条隧道实体（漩涡贴图 + 中心经文字）作为同一旋转单位一起转。
 * 关键前提（编辑器侧）：
 *   1) 中心经文字必须【挂为 10_经文隧道叠加 的子级】（或与其共享同一个旋转父级），
 *      这样它才会继承本函数驱动的旋转；否则它仍是独立对象，不会跟着转。
 *   2) 不要再给漩涡单独挂旋转动画（AnimSequence / 关键帧），否则会与脚本叠加成双重加速。
 * 这样「漩涡转、中心字不转」的错位就被消除——二者始终同步。
 * ---------------------------------------------------------------------- */
FoShouNamasteController.prototype._sutraTransform = function () {
  var ent = this.entities[L.SUTRA];
  if (!ent) return null;
  var tf = null;
  try {
    tf = ent.transform ||
         (ent.getComponent && (ent.getComponent('Transform') || ent.getComponent('ScreenTransform')));
  } catch (e) { tf = null; }
  return tf;
};

FoShouNamasteController.prototype.rotateSutra = function (dt) {
  var tf = this._sutraTransform();
  if (!tf) return;
  if (this.sutraAngle === undefined) this.sutraAngle = 0;
  this.sutraAngle += dt * CFG.SUTRA_SPIN;
  var a = this.sutraAngle;
  var half = a * 0.5;
  var q = { w: Math.cos(half), x: 0, y: 0, z: Math.sin(half) };   // 绕 Z 轴旋转四元数
  var done = false;
  try { if (tf.setLocalOrientation) { tf.setLocalOrientation(q); done = true; } } catch (e) {}
  if (!done) { try { tf.localOrientation = q; done = true; } catch (e) {} }
  if (!done) { try { if (tf.setRotation) { tf.setRotation(a); done = true; } } catch (e) {} }
  if (!done) { try { tf.rotation = a * 180 / Math.PI; done = true; } catch (e) {} }
  if (!done) { try { if (tf.setEulerAngle) { tf.setEulerAngle(0, 0, a * 180 / Math.PI); done = true; } } catch (e) {} }
  if (!done) { try { tf.eulerAngles = { x: 0, y: 0, z: a * 180 / Math.PI }; done = true; } catch (e) {} }
};

FoShouNamasteController.prototype.resetSutraRotation = function () {
  this.sutraAngle = 0;
  var tf = this._sutraTransform();
  if (!tf) return;
  var q = { w: 1, x: 0, y: 0, z: 0 };
  try { if (tf.setLocalOrientation) tf.setLocalOrientation(q); else tf.localOrientation = q; } catch (e) {}
};

/* -------------------------------------------------------------------------
 * 双手合十检测：官方手势分类 + 关键点兜底
 * ---------------------------------------------------------------------- */
FoShouNamasteController.prototype.apjs = function () {
  if (this.apjsRef) return this.apjsRef;   // 找到后缓存，避免每帧 require
  var a = null;
  try { if (typeof APJS !== 'undefined') a = APJS; } catch (e) { a = null; }
  if (!a && typeof effect !== 'undefined') {
    try { a = effect.APJS || null; } catch (e) { a = null; }
  }
  if (!a && typeof require === 'function') {
    try { a = require('amazingpro'); } catch (e) { a = null; }
  }
  if (a) this.apjsRef = a;
  return a;
};

/** 收集当前版本里「合十」及相近合掌手势的枚举值 / 名称。 */
FoShouNamasteController.prototype.accepted = function () {
  // 枚举可能要等运行时就绪后才出现，拿到数值枚举前每帧重新收集
  if (this.acceptedActions && this.acceptedComplete) return this.acceptedActions;
  var nums = {};
  var names = {
    Namaste: 1, NAMASTE: 1, namaste: 1,
    'Touching Palms': 1, '双手合十': 1, '合十': 1
  };
  if (CFG.ACCEPT_SIMILAR) {
    names.Beg = 1; names.BEG = 1; names.beg = 1;
    names.Pray = 1; names.PRAY = 1; names.pray = 1;
    names['Kung Fu Salute(Fist Uncovered)'] = 1;
    names['"Pray"'] = 1;
  }
  var apjs = this.apjs();
  // 数值枚举只收 Namaste：Beg 在部分版本里枚举值为 0，直接按数值匹配
  // 会把「未分类」的手误判成合十；相近手势只按字符串名兼容。
  var pairs = [
    [apjs && apjs.HandAction, 'Namaste'],
    [Amaz && Amaz.HandAction, 'NAMASTE']
  ];
  for (var i = 0; i < pairs.length; i++) {
    var en = pairs[i][0], key = pairs[i][1];
    if (!en) continue;
    var v = en[key];
    if (typeof v === 'number') { nums[v] = 1; this.acceptedComplete = true; }
  }
  this.acceptedActions = { nums: nums, names: names };
  return this.acceptedActions;
};

FoShouNamasteController.prototype.actionMatches = function (hand) {
  if (!hand) return false;
  var a = hand.action;
  if (a === undefined || a === null) {
    try { if (hand.getAction) a = hand.getAction(); } catch (e) { a = null; }
  }
  if (a === undefined || a === null) {
    a = hand.actionName || hand.actionString || hand.gesture || null;
  }
  if (a === undefined || a === null) return false;
  var acc = this.accepted();
  if (typeof a === 'number') return acc.nums[a] === 1;
  if (typeof a === 'string') return acc.names[a] === 1;
  return false;
};

FoShouNamasteController.prototype.pointsOf = function (hand) {
  if (!hand) return null;
  var p = hand.keypoints || hand.landmarks || hand.points || null;
  if (!p && hand.getKeypoints) {
    try { p = hand.getKeypoints(); } catch (e) { p = null; }
  }
  return (p && p.length >= 13) ? p : null;
};

/** 两掌靠近、指尖朝上、位于画面中下部 → 合十。 */
FoShouNamasteController.prototype.namasteByKeypoints = function (hands) {
  if (!hands || hands.length < 2) return false;
  var a = this.pointsOf(hands[0]);
  var b = this.pointsOf(hands[1]);
  if (!a || !b) return false;
  var aw = a[0], bw = b[0];
  if (!aw || !bw) return false;
  var midX = (aw.x + bw.x) * 0.5;
  var midY = (aw.y + bw.y) * 0.5;
  if (midY < 0.30 || midY > 0.98) return false;
  if (midX < 0.08 || midX > 0.92) return false;
  if (Math.abs(aw.x - bw.x) > 0.28) return false;
  var at = a[12] || a[8], bt = b[12] || b[8];
  if (!at || !bt) return false;
  if (at.y > midY - 0.03 || bt.y > midY - 0.03) return false;  // 指尖须在腕上方
  if (Math.abs(at.x - bt.x) > 0.18) return false;
  return true;
};

/** 读取当前帧算法结果，返回是否检测到双手合十。 */
FoShouNamasteController.prototype.readNamaste = function () {
  var result = null;
  var apjs = this.apjs();

  // 新运行时：APJS.AlgorithmManager.getResult()
  if (apjs && apjs.AlgorithmManager && apjs.AlgorithmManager.getResult) {
    try { result = apjs.AlgorithmManager.getResult(); } catch (e) { result = null; }
    if (result) this.algorithmSource = 'APJS.AlgorithmManager';
  }
  // 旧运行时：Amaz.AmazingManager.getSingleton('Algorithm')
  if (!result && Amaz && Amaz.AmazingManager && Amaz.AmazingManager.getSingleton) {
    try {
      var mgr = Amaz.AmazingManager.getSingleton('Algorithm');
      if (mgr && mgr.getAEAlgorithmResult) result = mgr.getAEAlgorithmResult();
    } catch (e) { result = null; }
    if (result) this.algorithmSource = 'Amaz.Algorithm';
  }

  var hands = [];
  if (result) {
    var count = 0;
    try {
      if (result.getHand2DCount) count = result.getHand2DCount();
      else if (result.getHandCount) count = result.getHandCount();
    } catch (e) { count = 0; }
    for (var i = 0; i < count; i++) {
      var h = null;
      try {
        h = result.getHand2DInfo ? result.getHand2DInfo(i) :
            (result.getHandInfo ? result.getHandInfo(i) : null);
      } catch (e) { h = null; }
      if (h) hands.push(h);
    }
    if (!this.loggedSource) {
      this.loggedSource = true;
      this.log('algorithm ready source=' + this.algorithmSource + ' hands=' + hands.length);
    }
  }

  for (var j = 0; j < hands.length; j++) {
    if (this.actionMatches(hands[j])) return true;
  }
  // 分类结果不可用时，用两掌关键点兜底
  if (this.namasteByKeypoints(hands)) return true;
  return false;
};

/* -------------------------------------------------------------------------
 * 状态机
 * ---------------------------------------------------------------------- */
FoShouNamasteController.prototype.onInit = function () {
  this.log('onInit');
};

FoShouNamasteController.prototype.onStart = function () {
  // 全局唯一实例：JSScriptComponent 与「可视化脚本兜底」同时存在时只保留一个
  try {
    var g = (typeof effect !== 'undefined') ? effect : {};
    if (g.__FoShouNamaste && g.__FoShouNamaste.instance &&
        g.__FoShouNamaste.instance !== this) {
      this.disabled = true;
      this.log('duplicate instance disabled');
      return;
    }
    g.__FoShouNamaste = { instance: this, fromGraph: !!this.fromGraph };
  } catch (e) { /* 全局标记不可用不影响单实例运行 */ }
  this.bindLayers();
  this.bindAudio();            // 绑定 BgmPlayer 的 AudioComponent，合十触发时由 playBgm() 启动
  this.enterIdle();
  this.log('onStart state=idle (waiting for Namaste)');
};

FoShouNamasteController.prototype.enterIdle = function () {
  this.state = STATE.IDLE;
  this.elapsed = 0;
  this.hold = 0;
  this.hintTime = 0;
  this.stopBgm();              // 回待机：停止背景音乐（首次 onStart 时尚未播放，stop 无害）

  // ★ 没合十就一直提示：引导文案 + 合十引导框常驻
  this.setVisible(L.GUIDE, true);
  this.setVisible(L.BOX, true);
  this.setOpacity(L.GUIDE, 1.0);
  this.setOpacity(L.BOX, 1.0);

  // 待机氛围：静态石窟背景半透明叠在实时人像上
  this.setVisible(L.BG, true);
  this.setOpacity(L.BG, CFG.IDLE_BG_OPACITY);
  this.setVisible(L.STAR, true);
  this.setVisible(L.CAM, true);
  this.setOpacity(L.CAM, 1.0);

  // 特效未开始：主片与所有触发后才出现的图层全部隐藏
  this.setVisible(L.MAIN, false);
  [L.WHEEL, L.FLASH, L.HALO, L.TITLE, L.SUB, L.SUTRA, L.REF]
    .forEach(function (n) { this.setVisible(n, false); }, this);
};

/** 触发时把 20 秒序列帧重置到第 0 帧再播放。 */
FoShouNamasteController.prototype.restartFilm = function () {
  var img = this.comps.MAIN;
  if (!img) return;
  var tex = null;
  try { tex = img.texture || (img.getTexture ? img.getTexture() : null); }
  catch (e) { tex = null; }
  var candidates = [tex];
  try {
    if (tex) {
      candidates.push(tex.provider);
      candidates.push(tex.textureDelegate);
      if (tex.getControl) candidates.push(tex.getControl());
    }
  } catch (e) { /* 忽略 */ }

  for (var i = 0; i < candidates.length; i++) {
    var c = candidates[i];
    if (!c) continue;
    if (!(c.reset || c.resetAnim || c.stop || c.playFromTo)) continue;
    try {
      if (c.resetAnim) c.resetAnim();
      else if (c.reset) c.reset();
      else if (c.stop) c.stop();
      var last = 199;
      if (c.getFrameCount) {
        var n = c.getFrameCount();
        if (n > 0) last = n - 1;
      }
      if (c.playFromTo) c.playFromTo(0, last);
      if (c.play) c.play();
      this.log('main film restarted from frame 0');
      return;
    } catch (e) { /* 试下一个候选对象 */ }
  }
  this.log('main film reset API unavailable; texture will play from its current frame');
};

FoShouNamasteController.prototype.startEffect = function () {
  this.state = STATE.PLAYING;
  this.elapsed = 0;
  this.hold = 0;

  // 收起提示与待机氛围
  [L.GUIDE, L.BOX, L.STAR, L.BG, L.REF].forEach(function (n) {
    this.setVisible(n, false);
  }, this);

  // 20 秒主片从第 0 帧开始，半透明叠加在实时人像之上
  this.setVisible(L.MAIN, true);
  this.setOpacity(L.MAIN, CFG.FUSION_START_OPACITY);
  this.restartFilm();

  // 摄像头底图任何阶段都不关
  this.setVisible(L.CAM, true);
  this.setOpacity(L.CAM, 1.0);
  this.playBgm();              // 合十触发主片：启动背景音乐（循环播放，isPlaying 守卫避免重播）
  this.log('[state] idle -> playing (Namaste held ' + CFG.HOLD_REQUIRED + 's)');
};

FoShouNamasteController.prototype.onUpdate = function (dt) {
  if (this.disabled) return;
  dt = Math.min(Math.max(dt || 0, 0), 0.1);
  if (!this.bound) this.bindLayers();

  var gesture = this.readNamaste();
  if (gesture) this.hold += dt;
  else this.hold = Math.max(0, this.hold - dt * CFG.LOSE_GRACE);

  if (this.state === STATE.IDLE) {
    this.hintTime += dt;

    // 持续提示 + 呼吸动画；识别到合十时点亮金轮作为「识别中」反馈
    var breath = 0.72 + 0.28 * (0.5 + 0.5 *
                 Math.sin(this.hintTime * Math.PI * 2 / CFG.HINT_CYCLE));
    this.setVisible(L.GUIDE, true);
    this.setVisible(L.BOX, true);
    this.setVisible(L.STAR, true);
    this.setVisible(L.BG, true);
    this.setVisible(L.CAM, true);
    this.setVisible(L.MAIN, false);
    this.setOpacity(L.BG, CFG.IDLE_BG_OPACITY);
    this.resetSutraRotation();   // 待机时隧道隐藏，旋转归零，下次出现从 0 开始
    this.setOpacity(L.BOX, gesture ? 1.0 : breath);
    this.setOpacity(L.GUIDE, gesture ? 1.0 : 0.86 + 0.14 * breath);
    this.setVisible(L.WHEEL, gesture);

    if (this.hold >= CFG.HOLD_REQUIRED) this.startEffect();
    return;
  }

  if (this.state === STATE.PLAYING) {
    this.elapsed += dt;
    var t = this.elapsed;

    this.setVisible(L.WHEEL, t < 1.2);
    this.setVisible(L.FLASH, t >= 0.9 && t < 1.35);
    var sutraOn = (t >= 4.0 && t < 8.5);
    this.setVisible(L.SUTRA, sutraOn);
    if (sutraOn) this.rotateSutra(dt); else this.resetSutraRotation();
    this.setVisible(L.HALO, t >= 12.5);
    this.setVisible(L.TITLE, t >= 12.5);
    this.setVisible(L.SUB, t >= 12.5);

    var k = Math.min(1, t / CFG.FUSION_FADE);
    this.setOpacity(L.MAIN, CFG.FUSION_START_OPACITY +
                    (CFG.FUSION_OPACITY - CFG.FUSION_START_OPACITY) * k);
    this.setVisible(L.CAM, true);
    this.setOpacity(L.CAM, 1.0);

    if (t >= CFG.DURATION) {
      this.state = STATE.END;
      this.elapsed = CFG.DURATION;
      this.hold = 0;
      [L.WHEEL, L.FLASH, L.SUTRA].forEach(function (n) {
        this.setVisible(n, false);
      }, this);
      this.resetSutraRotation();
      // 结尾定格，并把合十提示再次放出来，等待下一次合十重播
      this.setVisible(L.GUIDE, true);
      this.setVisible(L.BOX, true);
      this.log('[state] playing -> end (freeze + hint again)');
    }
    return;
  }

  // END：再次合十才重播，点屏不能代替
  this.setVisible(L.GUIDE, true);
  this.setVisible(L.BOX, true);
  this.setVisible(L.CAM, true);
  if (this.hold >= CFG.HOLD_REQUIRED) this.startEffect();
};

/**
 * 仅用于联调：把 ALLOW_TAP_FALLBACK 改成 true 后，点屏可临时代替合十。
 * 默认关闭，保证「没合十就一直提示」的产品规则不被绕过。
 */
FoShouNamasteController.prototype.onEvent = function (event) {
  if (this.disabled || !CFG.ALLOW_TAP_FALLBACK || !event) return;
  var isTap = false;
  try {
    var apjs = this.apjs();
    if (apjs && apjs.EventType && event.type === apjs.EventType.Touch) isTap = true;
    if (event.type === 'Touch' || event.type === 'touch') isTap = true;
  } catch (e) { isTap = false; }
  if (isTap && this.state !== STATE.PLAYING) {
    this.log('[debug] tap fallback triggered');
    this.startEffect();
  }
};

FoShouNamasteController.prototype.onDestroy = function () {
  this.log('onDestroy');
};

exports.FoShouNamasteController = FoShouNamasteController;
