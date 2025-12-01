/**
 * Componente: gesto-pellizco
 * Detecta pellizco + crea colisionador OBB por cada mano.
 * Eventos: pinchstart, pinchmove, pinchend (con info de colisión).
 */
AFRAME.registerComponent('gesto-pellizco', {
    schema: {
        hand: {type: 'string', default: 'any'},
        startDistance: {type: 'number', default: 0.025},
        endDistance: {type: 'number', default: 0.035},
        emitEachFrame: {type: 'boolean', default: false},
        log: {type: 'boolean', default: false},
        // Tamaño del colisionador OBB de la mano (caja fija, no ajustada a forma real)
        colliderSize: {type: 'vec3', default: {x: 0.15, y: 0.15, z: 0.15}},
        debugCollider: {type: 'boolean', default: false}
    },

        init: function () {
        this.renderer = null;
        this.referenceSpace = null;
        this.state = {
            left:  { pinching: false, lastDistance: null, obb: null },
            right: { pinching: false, lastDistance: null, obb: null }
        };

        ['left', 'right'].forEach(h => {
            const handState = this.state[h];
            handState.obb = {
                center: new THREE.Vector3(),
                size: new THREE.Vector3(
                    this.data.colliderSize.x,
                    this.data.colliderSize.y,
                    this.data.colliderSize.z
                ),
                halfSize: new THREE.Vector3(
                    this.data.colliderSize.x / 2,
                    this.data.colliderSize.y / 2,
                    this.data.colliderSize.z / 2
                ),
                quaternion: new THREE.Quaternion(),
                matrix: new THREE.Matrix4(),
                box3: new THREE.Box3()  // ← AÑADIDO: faltaba esto
            };

            // Debug visual opcional
            if (this.data.debugCollider) {
                const debugBox = document.createElement('a-box');
                debugBox.setAttribute('width', this.data.colliderSize.x);
                debugBox.setAttribute('height', this.data.colliderSize.y);
                debugBox.setAttribute('depth', this.data.colliderSize.z);
                debugBox.setAttribute('color', h === 'left' ? '#0af' : '#fa0');
                debugBox.setAttribute('opacity', 0.2);
                debugBox.setAttribute('wireframe', true);
                this.el.sceneEl.appendChild(debugBox);
                handState.obb.debugBox = debugBox;
            }
        });
    },
    remove: function () {
        ['left', 'right'].forEach(h => {
            if (this.state[h].obb.debugBox) {
                this.state[h].obb.debugBox.remove();
            }
        });
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
            const wristJoint = inputSource.hand.get('wrist');
            const middleTipJoint = inputSource.hand.get('middle-finger-tip');
            
            if (!thumbJoint || !indexJoint || !wristJoint || !middleTipJoint) continue;

            const thumbPose = frame.getJointPose(thumbJoint, this.referenceSpace);
            const indexPose = frame.getJointPose(indexJoint, this.referenceSpace);
            const wristPose = frame.getJointPose(wristJoint, this.referenceSpace);
            const middleTipPose = frame.getJointPose(middleTipJoint, this.referenceSpace);
            
            if (!thumbPose || !indexPose || !wristPose || !middleTipPose) continue;

            // Distancia pellizco
            const dx = thumbPose.transform.position.x - indexPose.transform.position.x;
            const dy = thumbPose.transform.position.y - indexPose.transform.position.y;
            const dz = thumbPose.transform.position.z - indexPose.transform.position.z;
            const distance = Math.sqrt(dx*dx + dy*dy + dz*dz);

            const handState = this.state[handedness];
            handState.lastDistance = distance;

            // Centro del colisionador: punto medio entre muñeca y punta del dedo medio
            const wPos = wristPose.transform.position;
            const mPos = middleTipPose.transform.position;
            handState.obb.center.set(
                (wPos.x + mPos.x) / 2,
                (wPos.y + mPos.y) / 2,
                (wPos.z + mPos.z) / 2
            );
            
           
            // Rotación del colisionador: usar la orientación de la muñeca
            const wQuat = wristPose.transform.orientation;
            handState.obb.quaternion.set(wQuat.x, wQuat.y, wQuat.z, wQuat.w);

            // Actualizar Box3 con tamaño FIJO de colliderSize
            handState.obb.box3.setFromCenterAndSize(handState.obb.center, handState.obb.size);

            // Debug visual
            if (handState.obb.debugBox) {
                handState.obb.debugBox.object3D.position.copy(handState.obb.center);
                handState.obb.debugBox.object3D.quaternion.copy(handState.obb.quaternion);
            }

            // Detección de pellizco
            if (!handState.pinching && distance <= this.data.startDistance) {
                handState.pinching = true;
                this._emit('pinchstart', handedness, distance, handState.obb);
            } else if (handState.pinching && distance >= this.data.endDistance) {
                handState.pinching = false;
                this._emit('pinchend', handedness, distance, handState.obb);
            } else if (handState.pinching && this.data.emitEachFrame) {
                this._emit('pinchmove', handedness, distance, handState.obb);
            }
        }
    },

    _emit: function (type, hand, distance, obb) {
        if (this.data.log) {
            console.log(`[gesto-pellizco] ${type} mano=${hand} dist=${distance.toFixed(4)}m`);
        }
        this.el.emit(type, { hand, distance, obb }, false);
    },

    // API pública: obtener OBB de una mano
    getHandOBB: function(handedness) {
        return this.state[handedness] ? this.state[handedness].obb : null;
    }
});

// Listeners globales (mensaje visual)
document.addEventListener('DOMContentLoaded', () => {
    const detector = document.getElementById('detector');
    const msg = document.getElementById('pinchMessage');
    let hideTimeout = null;

    function setMessage(text, color = '#FFFFFF', autoHideMs = null) {
        if (!msg) return;
        msg.setAttribute('value', text);
        msg.setAttribute('color', color);
        if (hideTimeout) {
            clearTimeout(hideTimeout);
            hideTimeout = null;
        }
        if (autoHideMs && autoHideMs > 0) {
            hideTimeout = setTimeout(() => {
                msg.setAttribute('value', 'Haz un pellizco cerca del objeto');
                msg.setAttribute('color', '#AAAAFF');
            }, autoHideMs);
        }
    }

    if (!detector) return;

    detector.addEventListener('pinchstart', e => {
        //console.log('[PINCH] start', e.detail);
        setMessage(`PINCH START (${e.detail.hand})`, '#00FF66', null);
    });

    detector.addEventListener('pinchend', e => {
        //console.log('[PINCH] end', e.detail);
        setMessage(`PINCH END (${e.detail.hand})`, '#FF5555', 1200);
    });
});