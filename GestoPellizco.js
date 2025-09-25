/**
 * Componente A-Frame: gesto-pellizco
 * Detecta cuando la punta del pulgar y la punta del índice se acercan (pinch).
 * Emite eventos: pinchstart, pinchmove (opcional), pinchend.
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
        const sceneEl = this.el.sceneEl;
        if (!sceneEl || !sceneEl.renderer) return;
        if (!this.renderer) this.renderer = sceneEl.renderer;

        const session = this.renderer.xr.getSession();
        if (!session) return;

        const frame = sceneEl.frame;
        if (!frame) return;

        if (!this.referenceSpace) {
            this.referenceSpace = this.renderer.xr.getReferenceSpace();
            if (!this.referenceSpace) return;
        }

        for (const inputSource of session.inputSources) {
            if (!inputSource.hand) continue;

            const handedness = inputSource.handedness;
            if (this.data.hand !== 'any' && handedness !== this.data.hand) continue;

            const thumbJoint = inputSource.hand.get('thumb-tip');
            const indexJoint = inputSource.hand.get('index-finger-tip');
            if (!thumbJoint || !indexJoint) continue;

            const thumbPose = frame.getJointPose(thumbJoint, this.referenceSpace);
            const indexPose = frame.getJointPose(indexJoint, this.referenceSpace);
            if (!thumbPose || !indexPose) continue;

            const dx = thumbPose.transform.position.x - indexPose.transform.position.x;
            const dy = thumbPose.transform.position.y - indexPose.transform.position.y;
            const dz = thumbPose.transform.position.z - indexPose.transform.position.z;
            const distance = Math.sqrt(dx*dx + dy*dy + dz*dz);

            if (this.data.debug) {
                this._setEntityPos(this.debugThumb, thumbPose.transform.position);
                this._setEntityPos(this.debugIndex, indexPose.transform.position);
            }

            const handState = this.state[handedness];
            handState.lastDistance = distance;

            if (!handState.pinching && distance <= this.data.startDistance) {
                handState.pinching = true;
                this._emit('pinchstart', handedness, distance);
            } else if (handState.pinching && distance >= this.data.endDistance) {
                handState.pinching = false;
                this._emit('pinchend', handedness, distance);
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

// Listeners globales + mensaje visual
document.addEventListener('DOMContentLoaded', () => {
    const detector = document.getElementById('detector');
    const msg = document.getElementById('pinchMessage'); // Puede ser null si no existe
    let hideTimeout = null;

    function setMessage(text, color='#FFFFFF', autoHideMs=1500) {
        if (!msg) return;
        msg.setAttribute('value', text);
        msg.setAttribute('color', color);
        if (hideTimeout) clearTimeout(hideTimeout);
        if (autoHideMs > 0) {
            hideTimeout = setTimeout(() => {
                msg.setAttribute('value', 'Haz un pellizco (pulgar + índice)');
                msg.setAttribute('color', '#AAAAFF');
            }, autoHideMs);
        }
    }

    if (!detector) {
        console.warn('[gesto-pellizco] No se encontró #detector en DOM.');
        return;
    }

    detector.addEventListener('pinchstart', e => {
        console.log('[PINCH] start', e.detail);
        setMessage(`PINCH START (${e.detail.hand})`, '#00FF66');
    });

    detector.addEventListener('pinchend', e => {
        console.log('[PINCH] end', e.detail);
        setMessage(`PINCH END (${e.detail.hand})`, '#FF5555');
    });

    detector.addEventListener('pinchmove', e => {
        // Activar emitEachFrame:true si se desea mostrar distancia dinámica
        // setMessage(`PINCH ${e.detail.hand} ${e.detail.distance.toFixed(3)}m`, '#FFFF66', 300);
    });
});