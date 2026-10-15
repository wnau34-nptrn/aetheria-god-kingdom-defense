import './styles/game.css';
import './legacy/webgl-engine.js';

function showStartupError(error) {
  console.error(error);
  const message = document.createElement('div');
  message.setAttribute('role', 'alert');
  message.style.cssText = 'position:fixed;inset:20%;z-index:1000;padding:24px;background:#0b1324;color:#fff;border:1px solid #fb7185;border-radius:16px;overflow:auto';
  message.textContent = 'ไม่สามารถเริ่มเกม 3D ได้ กรุณาเปิด WebGL / Hardware Acceleration และโหลดหน้าใหม่';
  document.body.appendChild(message);
}
// Keep a visible error when WebGL or shaders cannot start.
import('./legacy/game.js').catch(showStartupError);
document.getElementById('game-canvas').addEventListener('webglcontextlost', (event) => {
  event.preventDefault();
  showStartupError(new Error('WebGL context lost; reload to restart.'));
});
