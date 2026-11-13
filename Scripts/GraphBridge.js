/**
 * 【已废弃 / 仅作历史记录】
 * ---------------------------------------------------------------------------
 * 本文件原先是「把 FoShouGame.js 手动粘贴到开始 / 每帧执行节点」的参考代码，
 * 但那条链路并没有真正挂载到 Graph，且依赖了像塑并不存在的
 * setCameraFacing / getCameraTexture / getAlgorithm / getDetector 等 API。
 *
 * 现在「双手合十才触发 / 没合十就一直提示」的交互已按官方机制真正落地：
 *
 *   1. 控制器：js/FoShouNamasteController.js
 *      官方 JSScriptComponent，挂在 Assets/main.scene 的「2D前景特效」实体上，
 *      path: js/FoShouNamasteController.js。它每帧读取官方手势算法结果
 *      （APJS.HandAction.Namaste / Amaz.HandAction.NAMASTE），
 *      未合十时保持 02/03 引导常驻，合十保持 0.8s 才启动 20 秒主片。
 *
 *   2. 算法声明：Graph/graph.json 中的官方「Gesture Detection」节点
 *      （templateGuid 67144819-16ad-b75d-18d3-0b965c0bafdb，
 *       Detect=Either，Gesture=Touching Palms），
 *      让工程启用 2handGestureDetect 双手手势算法。
 *
 *   2b. 兜底：Graph/ScriptTemplate/OnStart/CGOnStart.js 与
 *       OnUpdate/CGOnUpdate.js 会在 JSScriptComponent 未被加载时，
 *       require 同一个控制器并用 effect.__FoShouNamaste 保证唯一实例。
 *
 *   3. 摄像头：Assets/main.scene 的 13 层绑定官方内置相机输入纹理
 *      share://input.texture，由宿主开启摄像头，脚本不负责打开。
 *
 *   4. 默认画面：Assets/main.scene 把 01 主片设为 enabled=false，
 *      02/03/05 提示层设为 enabled=true —— 即使脚本未加载，
 *      打开特效也会停在「持续提示、等待合十」的状态。
 *
 * 请勿再把本目录的 FoShouGame.js / GraphBridge.js 粘贴进联动脚本编辑器，
 * 否则会出现两套控制器互相覆盖图层显隐。参数请在
 * js/FoShouNamasteController.js 顶部的 CFG 中调整。
 */
