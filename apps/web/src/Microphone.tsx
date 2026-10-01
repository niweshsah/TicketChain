import { useEffect, useRef, useState } from 'react';
import { useReducedMotion } from './theme';
export default function Microphone() {
  const ref = useRef<HTMLDivElement>(null);
  const reduced = useReducedMotion();
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    const host = ref.current;
    if (!host) return;
    let disposed = false;
    let cleanup = () => {};
    const observer = new IntersectionObserver((entries) => {
      if (!entries.some((e) => e.isIntersecting)) return;
      observer.disconnect();
      void (async () => {
        try {
          const THREE = await import('three');
          const { GLTFLoader } =
            await import('three/examples/jsm/loaders/GLTFLoader.js');
          if (disposed) return;
          const renderer = new THREE.WebGLRenderer({
            alpha: true,
            antialias: true,
          });
          renderer.setSize(host.clientWidth, 280);
          renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
          const scene = new THREE.Scene();
          const camera = new THREE.PerspectiveCamera(
            35,
            host.clientWidth / 280,
            0.1,
            2000,
          );
          camera.position.set(0, 0, 500);
          scene.add(new THREE.HemisphereLight(0xffffff, 0xaa77dd, 3));
          const light = new THREE.DirectionalLight(0xffffff, 3);
          light.position.set(200, 200, 300);
          scene.add(light);
          const model = await new GLTFLoader().loadAsync('/microphone.glb');
          if (disposed) {
            renderer.dispose();
            return;
          }
          const box = new THREE.Box3().setFromObject(model.scene);
          const center = box.getCenter(new THREE.Vector3());
          const size = box.getSize(new THREE.Vector3());
          model.scene.position.sub(center);
          const display = new THREE.Group();
          display.add(model.scene);
          display.scale.setScalar(220 / Math.max(size.x, size.y, size.z));
          display.rotation.y = Math.PI / 2;
          scene.add(display);
          host.replaceChildren(renderer.domElement);
          let frame = 0;
          const draw = () => {
            if (disposed) return;
            if (!reduced) display.rotation.y += 0.006;
            renderer.render(scene, camera);
            if (!reduced) frame = requestAnimationFrame(draw);
          };
          draw();
          const sizing = new ResizeObserver(() => {
            renderer.setSize(host.clientWidth, 280);
            camera.aspect = host.clientWidth / 280;
            camera.updateProjectionMatrix();
            renderer.render(scene, camera);
          });
          sizing.observe(host);
          cleanup = () => {
            sizing.disconnect();
            cancelAnimationFrame(frame);
            model.scene.traverse((node) => {
              if (node instanceof THREE.Mesh) {
                node.geometry.dispose();
                const materials = Array.isArray(node.material)
                  ? node.material
                  : [node.material];
                materials.forEach((m) => m.dispose());
              }
            });
            renderer.dispose();
            host.replaceChildren();
          };
        } catch {
          if (!disposed) setFailed(true);
        }
      })();
    });
    observer.observe(host);
    return () => {
      disposed = true;
      observer.disconnect();
      cleanup();
    };
  }, [reduced]);
  return (
    <div className="microphone" aria-label="Microphone illustration">
      <div ref={ref}>
        {failed ? '♫' : <span className="mic-fallback">🎙</span>}
      </div>
      <small>
        Microphone by <a href="https://sketchfab.com/Helindu">Helindu</a> · CC
        BY 4.0
      </small>
    </div>
  );
}
