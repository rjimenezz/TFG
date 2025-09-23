/**
 * Componente A-Frame: gesto-pellizco
 * Detecta cuando la punta del pulgar y la punta del índice se acercan (pinch).
 * Emite eventos: pinchstart, pinchmove (opcional), pinchend.
 *
 * Parámetros:
 *  hand: 'left' | 'right' | 'any'
 *  startDistance: distancia (m) que activa el pellizco
 *  endDistance: distancia (m) que libera (mayor para histéresis)
 *  emitEachFrame: si true, emite pinchmove cada frame mientras está activo
 *  log: muestra transiciones en consola
 *  debug: dibuja esferas en las puntas (útil capturas para TFG)
 *
 * Histéresis (startDistance < endDistance) evita oscilaciones rápidas.
 */
AFRAME.registerComponent('gesto-pellizco', {
    schema: {
        hand: {type: 'string', default: 'any'},
        startDistance: {type: 'number', default: 0.025},
        endDistance: {type: 'number', default: 0.035},
        emitEachFrame: {type: 'boolean', default: false},
        log: {type: 'boolean', default: false},
        debug: {type: 'boolean', default: false}
    },

    init: function () {
        this.renderer = null;
        this.referenceSpace = null;

        this.state = {
            left:  { pinching: false, lastDistance: null },
            right: { pinching: false, lastDistance: null }
        };

        if (this.data.debug) {
            this.debugThumb = document.createElement('a-sphere');
            this.debugThumb.setAttribute('radius', 0.005);
            this.debugThumb.setAttribute('color', '#ffcc00');
            this.el.sceneEl.appendChild(this.debugThumb);

            this.debugIndex = document.createElement('a-sphere');
            this.debugIndex.setAttribute('radius', 0.005);
            this.debugIndex.setAttribute('color', '#00ccff');
            this.el.sceneEl.appendChild(this.debugIndex);
        }
    },

    remove: function () {
        if (this.debugThumb) this.debugThumb.remove();
        if (this.debugIndex) this.debugIndex.remove();
    },

    tick: function () {
        // 1. Referencia a la escena y comprobaciones básicas
        const sceneEl = this.el.sceneEl;
        if (!sceneEl || !sceneEl.renderer) return; // Si aún no está listo el renderer, salir

        // 2. Guardar renderer (una sola vez)
        if (!this.renderer) this.renderer = sceneEl.renderer;

        // 3. Obtener la sesión WebXR (si no hay sesión XR activa, no seguimos)
        const session = this.renderer.xr.getSession();
        if (!session) return;

        // 4. Frame actual (contiene poses/joint data de este frame)
        const frame = sceneEl.frame;
        if (!frame) return;

        // 5. ReferenceSpace para transformar a coordenadas del mundo
        if (!this.referenceSpace) {
            this.referenceSpace = this.renderer.xr.getReferenceSpace();
            if (!this.referenceSpace) return;
        }

        // 6. Recorrer todas las fuentes de entrada (controladores, manos, etc.)
        for (const inputSource of session.inputSources) {
            if (!inputSource.hand) continue; // Saltar si no es una mano (evita mandos)

            const handedness = inputSource.handedness; // 'left' o 'right'

            // 7. Filtrado opcional por mano (si el usuario fijó hand = 'left' o 'right')
            if (this.data.hand !== 'any' && handedness !== this.data.hand) continue;

            // 8. Obtener articulaciones clave de la mano
            const thumbJoint = inputSource.hand.get('thumb-tip');
            const indexJoint = inputSource.hand.get('index-finger-tip');
            if (!thumbJoint || !indexJoint) continue; // Si no están disponibles aún, saltar

            // 9. Obtener las poses (posición en el espacio de referencia)
            const thumbPose = frame.getJointPose(thumbJoint, this.referenceSpace);
            const indexPose = frame.getJointPose(indexJoint, this.referenceSpace);
            if (!thumbPose || !indexPose) continue;

            // 10. Calcular distancia euclídea entre pulgar e índice
            const dx = thumbPose.transform.position.x - indexPose.transform.position.x;
            const dy = thumbPose.transform.position.y - indexPose.transform.position.y;
            const dz = thumbPose.transform.position.z - indexPose.transform.position.z;
            const distance = Math.sqrt(dx*dx + dy*dy + dz*dz);

            // 11. Debug visual (si está activo, mover esferas)
            if (this.data.debug) {
                this._setEntityPos(this.debugThumb, thumbPose.transform.position);
                this._setEntityPos(this.debugIndex, indexPose.transform.position);
            }

            // 12. Recuperar el estado de esa mano
            const handState = this.state[handedness];
            handState.lastDistance = distance;

            // 13. Máquina de estados con histéresis:
            //    a) Activar pinch (pinchstart)
            if (!handState.pinching && distance <= this.data.startDistance) {
                handState.pinching = true;
                this._emit('pinchstart', handedness, distance);

            //    b) Desactivar pinch (pinchend)
            } else if (handState.pinching && distance >= this.data.endDistance) {
                handState.pinching = false;
                this._emit('pinchend', handedness, distance);

            //    c) Mientras activo, emitir pinchmove (si se configuró)
            } else if (handState.pinching && this.data.emitEachFrame) {
                this._emit('pinchmove', handedness, distance);
            }
        }
    },

    _emit: function (type, hand, distance) {
        if (this.data.log) {
            console.log(`[gesto-pellizco] ${type} mano=${hand} dist=${distance.toFixed(4)} m`);
        }
        this.el.emit(type, { hand, distance }, false);
    },

    _setEntityPos: function (entity, pos) {
        if (!entity) return;
        entity.object3D.position.set(pos.x, pos.y, pos.z);
    }
});

/**
 * Listeners globales:
 * Centraliza la captura de eventos sin poner JS en el HTML.
 * Ajusta emitEachFrame:true en el atributo del componente para activar pinchmove.
 */
document.addEventListener('DOMContentLoaded', () => {
    const detector = document.getElementById('detector');
    if (!detector) {
        console.warn('[gesto-pellizco] No se encontró #detector en DOM.');
        return;
    }
    detector.addEventListener('pinchstart', e => {
        console.log('[PINCH] start', e.detail);
    });
    detector.addEventListener('pinchend', e => {
        console.log('[PINCH] end', e.detail);
    });
    detector.addEventListener('pinchmove', e => {
        // console.log('[PINCH] move', e.detail);
    });
});