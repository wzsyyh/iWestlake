import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { extend } from '../engine/patch.js';

const FONT = '"PingFang SC", "Microsoft YaHei", "Noto Sans CJK SC", "Source Han Sans SC", "Helvetica Neue", Arial, sans-serif';

function canvasTexture(w, h, draw) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  return t;
}

/** Campus wayfinding totem face: bilingual, in the plain white-on-charcoal style of the real site signage. */
function totemFace(rows, here) {
  return canvasTexture(512, 1792, (g, w, h) => {
    g.fillStyle = '#1b1e21'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#f2f3f1';
    g.font = `700 58px ${FONT}`; g.fillText('西湖大学', 44, 118);
    g.font = `500 25px ${FONT}`; g.fillText('WESTLAKE UNIVERSITY', 46, 162);
    g.fillRect(44, 196, w - 88, 3);
    let y = 300;
    for (const [arrow, zh, en] of rows) {
      g.font = `400 72px ${FONT}`; g.fillText(arrow, 40, y + 18);
      g.font = `600 46px ${FONT}`; g.fillText(zh, 138, y);
      g.font = `400 24px ${FONT}`; g.fillStyle = 'rgba(242,243,241,0.72)'; g.fillText(en, 140, y + 40);
      g.fillStyle = '#f2f3f1';
      y += 168;
    }
    g.fillStyle = '#e8622a'; g.fillRect(44, h - 330, 14, 96);
    g.fillStyle = '#f2f3f1';
    g.font = `400 24px ${FONT}`; g.fillText('您在此处  YOU ARE HERE', 78, h - 296);
    g.font = `600 40px ${FONT}`; g.fillText(here[0], 78, h - 244);
    g.font = `400 22px ${FONT}`; g.fillStyle = 'rgba(242,243,241,0.72)'; g.fillText(here[1], 78, h - 206);
    g.fillStyle = 'rgba(242,243,241,0.4)'; g.font = `400 18px ${FONT}`; g.fillText('云谷校区  YUNGU CAMPUS', 44, h - 70);
  });
}

/** Security notice board put up when the court was closed. */
function noticeFace() {
  return canvasTexture(512, 720, (g, w, h) => {
    g.fillStyle = '#f0c419'; g.fillRect(0, 0, w, h);
    // hazard stripes top and bottom
    g.fillStyle = '#16181a';
    for (const y0 of [0, h - 70]) {
      g.save(); g.beginPath(); g.rect(0, y0, w, 70); g.clip();
      for (let x = -80; x < w + 80; x += 64) { g.beginPath(); g.moveTo(x, y0 + 70); g.lineTo(x + 32, y0 + 70); g.lineTo(x + 102, y0); g.lineTo(x + 70, y0); g.fill(); }
      g.restore();
    }
    g.textAlign = 'center';
    g.font = `800 92px ${FONT}`; g.fillText('封锁区域', w / 2, 210);
    g.font = `700 44px ${FONT}`; g.fillText('AREA CLOSED', w / 2, 272);
    g.fillRect(70, 304, w - 140, 5);
    g.font = `600 38px ${FONT}`; g.fillText('无人机试验失控', w / 2, 376);
    g.font = `500 25px ${FONT}`; g.fillText('ROBOTICS TEST FLEET UNRESPONSIVE', w / 2, 416);
    g.font = `600 38px ${FONT}`; g.fillText('请勿进入', w / 2, 492);
    g.font = `500 25px ${FONT}`; g.fillText('DO NOT ENTER', w / 2, 530);
    g.font = `400 20px ${FONT}`; g.fillText('工学院 · 集群机器人实验室 7C  ·  校园安保', w / 2, 604);
  });
}

/**
 * Wayfinding totems and closure notices around the court. Returns { group, colliders }.
 * (Run-time only: the lettering is drawn on canvases, so this is not part of the baked static level.)
 */
export function buildSignage(groundHeight) {
  const group = new THREE.Group();
  group.name = 'signage';
  const colliders = [];
  const body = extend(new THREE.MeshStandardMaterial({ color: new THREE.Color(0.075, 0.08, 0.085), roughness: 0.42, metalness: 0.85 }), []);
  const face = (map, rough = 0.38) => extend(new THREE.MeshStandardMaterial({ map, roughness: rough, metalness: 0.0 }), []);

  const rowsA = [['↑', '学术会堂', 'Academic Hall'], ['→', '工学院', 'School of Engineering'], ['←', '生命科学学院', 'School of Life Sciences'], ['↗', '理学院', 'School of Science'], ['↓', '学术环 · 东入口', 'Academic Ring · East Entrance']];
  const rowsB = [['↑', '学术环', 'Academic Ring'], ['←', '学术会堂', 'Academic Hall'], ['→', '工学院', 'School of Engineering'], ['↖', '图书馆', 'Library'], ['↓', '中心草坪', 'Central Lawn']];
  // [x, z, yaw, rows, here]
  const totems = [
    [107.5, 85.2, 0.75, rowsA, ['学术环 · 东南环廊', 'Academic Ring · South-East Promenade']],
    [71.5, 15.2, 2.9, rowsB, ['学术会堂 · 南广场', 'Academic Hall · South Plaza']],
    [92.5, 50.5, -0.6, rowsA, ['东南庭院', 'South-East Court']],
  ];
  const W = 0.62, H = 2.15, D = 0.12;
  for (const [x, z, yaw, rows, here] of totems) {
    const y = groundHeight(x, z);
    const g = new THREE.Group();
    g.position.set(x, y, z); g.rotation.y = yaw;
    const slab = new THREE.Mesh(new RoundedBoxGeometry(W, H, D, 2, 0.012), body);
    slab.position.y = H / 2;
    const base = new THREE.Mesh(new THREE.BoxGeometry(W + 0.1, 0.04, D + 0.16), body);
    base.position.y = 0.02;
    const tex = face(totemFace(rows, here));
    for (const s of [1, -1]) {
      const p = new THREE.Mesh(new THREE.PlaneGeometry(W - 0.03, H - 0.03), tex);
      p.position.set(0, H / 2, s * (D / 2 + 0.002)); p.rotation.y = s > 0 ? 0 : Math.PI;
      p.receiveShadow = true;
      g.add(p);
    }
    slab.castShadow = true; slab.receiveShadow = true; base.receiveShadow = true;
    g.add(slab, base);
    group.add(g);
    colliders.push({ x, z, r: 0.34, h: H });
  }

  // closure notices on A-frame stands where the paths enter the fenced court
  const notice = face(noticeFace(), 0.55);
  const stands = [[100.8, 86.5, 2.4], [118.5, 66.0, 1.2], [60.5, 60.0, -1.2], [79.0, 26.5, 3.0], [96.0, 97.5, 0.3]];
  for (const [x, z, yaw] of stands) {
    const y = groundHeight(x, z);
    const g = new THREE.Group();
    g.position.set(x, y, z); g.rotation.y = yaw;
    for (const s of [1, -1]) {
      const board = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.86, 0.018), body);
      board.position.set(0, 0.5, s * 0.14); board.rotation.x = -s * 0.24;
      const p = new THREE.Mesh(new THREE.PlaneGeometry(0.57, 0.8), notice);
      p.position.set(0, 0.5, s * 0.152); p.rotation.x = -s * 0.24; if (s < 0) p.rotation.y = Math.PI;
      if (s < 0) { p.rotation.set(0.24, Math.PI, 0); }
      board.castShadow = true; board.receiveShadow = true; p.receiveShadow = true;
      g.add(board, p);
    }
    group.add(g);
    colliders.push({ x, z, r: 0.36, h: 0.95 });
  }
  return { group, colliders };
}
