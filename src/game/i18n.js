/** UI strings (English / 简体中文). `t('key', a, b)` substitutes {0}, {1}. */
const STR = {
  en: {
    kicker: 'WESTLAKE UNIVERSITY · YUNGU CAMPUS · 西湖大学云谷校区',
    brief: "17:42. The Engineering School's swarm-robotics test fleet has stopped answering its operators. Security has fenced off the south-east court of the Academic Ring, between the Academic Hall and the promenade. Three hijacked uplinks are steering the swarm: cut them, then clear the sky. You have the prototype pulse carbine from Lab 7C.",
    deploy: 'DEPLOY', controls: 'CONTROLS', settings: 'SETTINGS',
    c_move: 'move', c_mouse: 'aim · left fire · right aim down sights', c_look: 'turn (also I J K L)', c_sprint: 'sprint', c_jump: 'jump', c_crouch: 'crouch',
    c_reload: 'reload', c_pause: 'pause', c_stats: 'stats', c_pad: 'Gamepads are supported.',
    s_quality: 'Graphics', s_sens: 'Sensitivity', s_fov: 'Field of view', s_vol: 'Volume', s_lang: 'Language',
    q_low: 'Low', q_medium: 'Medium', q_high: 'High', q_ultra: 'Ultra',
    credits: "Campus after HENN's Westlake University master plan (Academic Ring, Academic Hall). An unofficial fan project, not affiliated with Westlake University. Sky, textures and tree from Poly Haven and ambientCG (CC0).",
    paused: 'PAUSED', resume: 'RESUME', restart: 'RESTART', menu: 'MAIN MENU',
    integrity: 'INTEGRITY', hostile: 'HOSTILE', weapon: 'VX-9 PULSE CARBINE', reload: 'RELOAD',
    barrier: 'CONTAINMENT FIELD — TURN BACK',
    wave: 'WAVE {0} / {1}', waveEndless: 'WAVE {0} · ENDLESS',
    b_intro: 'ACADEMIC RING', b_introSub: 'SOUTH-EAST COURT · 17:42',
    b_wave: 'WAVE {0}', b_waveSub: '{0} HOSTILES', b_boss: 'WARDEN INBOUND', b_bossSub: 'AIM FOR THE EYE',
    b_clear: 'WAVE CLEARED', b_clearSub: 'REGROUP', b_win: 'RING SECURED', b_winSub: 'THE FLEET IS DOWN',
    destroyed: '{0} DESTROYED  +{1}', scout: 'KESTREL', gunner: 'HORNET', warden: 'WARDEN',
    p_ammo: 'ENERGY CELLS  +45', p_health: 'REPAIR NANITES  +35',
    e_winKicker: 'ALL HOSTILES DOWN', e_loseKicker: 'WAVE {0}', e_win: 'RING SECURED', e_lose: 'YOU ARE DOWN',
    e_time: 'Time', e_kills: 'Drones destroyed', e_acc: 'Accuracy', e_score: 'Score', e_again: 'KEEP FIGHTING', e_retry: 'RETRY WAVE',
    objective: 'UPLINKS CUT {0} / {1}', objectiveDone: 'UPLINKS CUT · CLEAR THE SKY', interact: 'Hold to cut uplink {0}',
    command: 'COMMAND',
    r_start: 'Three hijacked uplinks are steering the swarm. Cut all three. A, B and C are on your compass.',
    r_cut1: 'Uplink down. They know where you are now, so keep moving.',
    r_cut2: 'Two down. Heavier units are lifting off from the Engineering wing.',
    r_cut3: 'All uplinks cut. One signal left, and it is a big one. Aim for the eye.',
    r_win: 'Sky is clear. The Ring is yours. Good work.',
    r_hurt: 'You are taking hits, and a hit breaks the cut. Use the columns and the cases for cover.',
    b_cut: 'UPLINK {0} CUT', b_cutSub: '{0} OF {1}', c_interact: 'cut uplink',
    t_fire: 'FIRE', t_aim: 'AIM', t_reload: 'RELOAD', t_jump: 'JUMP', t_use: 'USE',
    nolock: 'Mouse capture unavailable: move the mouse or use the arrow keys to look, click to fire',
    l_start: 'Starting renderer', l_sky: 'Reading the sky', l_mat: 'Mixing materials', l_ring: 'Raising the Academic Ring', l_trees: 'Planting trees',
    l_bake: 'Loading baked lighting', l_bakeRun: 'Baking light (first run only)', l_gear: 'Unpacking equipment', l_probe: 'Capturing reflections', l_ready: 'Ready',
    l_unpack: 'Unpacking assets', l_fail: 'Failed to start: ',
  },
  zh: {
    kicker: '西湖大学 · 云谷校区 · WESTLAKE UNIVERSITY',
    brief: '17:42。工学院的集群机器人试验机队不再响应操作员指令。安保已封锁学术环东南庭院——学术会堂与环廊之间的区域。三处被劫持的上行链路正在操控机群：切断它们，再把这片天空清理干净。你手里只有 7C 实验室的脉冲卡宾枪原型机。',
    deploy: '开始行动', controls: '操作', settings: '设置',
    c_move: '移动', c_mouse: '瞄准 · 左键开火 · 右键机瞄', c_look: '转向（也可用 I J K L）', c_sprint: '冲刺', c_jump: '跳跃', c_crouch: '下蹲',
    c_reload: '换弹', c_pause: '暂停', c_stats: '性能', c_pad: '支持手柄。',
    s_quality: '画质', s_sens: '灵敏度', s_fov: '视野', s_vol: '音量', s_lang: '语言',
    q_low: '低', q_medium: '中', q_high: '高', q_ultra: '极致',
    credits: '校园依据 HENN 建筑事务所公开的西湖大学云谷校区总体规划（学术环、学术会堂）还原。非官方同人作品，与西湖大学无关。天空、贴图与树木来自 Poly Haven 与 ambientCG（CC0）。',
    paused: '已暂停', resume: '继续', restart: '重新开始', menu: '主菜单',
    integrity: '生命值', hostile: '敌机', weapon: 'VX-9 脉冲卡宾枪', reload: '换弹',
    barrier: '封锁力场 — 请返回',
    wave: '第 {0} / {1} 波', waveEndless: '第 {0} 波 · 无尽',
    b_intro: '学术环', b_introSub: '东南庭院 · 17:42',
    b_wave: '第 {0} 波', b_waveSub: '敌机 {0} 架', b_boss: '“典狱长”来袭', b_bossSub: '瞄准它的眼睛',
    b_clear: '本波肃清', b_clearSub: '重整态势', b_win: '学术环已肃清', b_winSub: '机队全部击落',
    destroyed: '击落 {0}  +{1}', scout: '红隼', gunner: '黄蜂', warden: '典狱长',
    p_ammo: '能量电池  +45', p_health: '修复纳米机  +35',
    e_winKicker: '敌机全灭', e_loseKicker: '第 {0} 波', e_win: '学术环已肃清', e_lose: '你倒下了',
    e_time: '用时', e_kills: '击落无人机', e_acc: '命中率', e_score: '得分', e_again: '继续战斗', e_retry: '重试本波',
    objective: '已切断链路 {0} / {1}', objectiveDone: '链路已全部切断 · 肃清空域', interact: '按住以切断上行链路 {0}',
    command: '指挥中心',
    r_start: '机群由三处被劫持的上行链路操控。把 A、B、C 全部切断，方位已标在罗盘上。',
    r_cut1: '链路已切断。它们知道你的位置了，保持移动。',
    r_cut2: '已切断两处。工学院方向有重型机体升空。',
    r_cut3: '链路全部切断。还剩最后一个信号，个头很大。瞄准它的眼睛。',
    r_win: '空域已肃清，学术环安全了。干得漂亮。',
    r_hurt: '你在持续中弹，中弹会打断切断操作。利用立柱和器材箱做掩体。',
    b_cut: '链路 {0} 已切断', b_cutSub: '{0} / {1}', c_interact: '切断链路',
    t_fire: '开火', t_aim: '瞄准', t_reload: '换弹', t_jump: '跳跃', t_use: '交互',
    nolock: '鼠标捕获不可用：移动鼠标或用方向键转向，点击开火',
    l_start: '启动渲染器', l_sky: '读取天空', l_mat: '调配材质', l_ring: '搭建学术环', l_trees: '栽种树木',
    l_bake: '载入烘焙光照', l_bakeRun: '烘焙光照（仅首次）', l_gear: '开箱装备', l_probe: '采集反射', l_ready: '就绪',
    l_unpack: '解包资源', l_fail: '启动失败：',
  },
};

let lang = 'en';

export function detectLanguage(params) {
  const q = params.get('lang');
  let stored = null;
  try { stored = localStorage.getItem('ringzero.lang'); } catch { /* private mode */ }
  const pick = q || stored || (navigator.language || 'en');
  return pick.toLowerCase().startsWith('zh') ? 'zh' : 'en';
}

export function setLanguage(l) {
  lang = STR[l] ? l : 'en';
  try { localStorage.setItem('ringzero.lang', lang); } catch { /* private mode */ }
  document.documentElement.lang = lang === 'zh' ? 'zh-CN' : 'en';
  for (const el of document.querySelectorAll('[data-i18n]')) el.textContent = t(el.dataset.i18n);
}

export function getLanguage() { return lang; }

export function t(key, ...args) {
  const s = STR[lang][key] ?? STR.en[key] ?? key;
  return args.length ? s.replace(/\{(\d)\}/g, (_, i) => args[+i]) : s;
}
