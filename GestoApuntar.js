/**
 * Componente: gesto-apuntar
 * Detecta cuando el usuario apunta con el dedo índice extendido (resto de dedos cerrados).
 * Perfecto para interacciones tipo "click" o "hover".
 * Eventos: pointstart, pointmove, pointend (con info de dirección y distancia)
 * 
 * Criterio: 
 * - Dedo índice extendido (punta lejos de la palma)
 * - Dedos medio, anular y meñique cerrados (cerca de la palma)
 * - ✅ PULGAR IGNORADO (puede estar extendido o no)
 * - ❌ Se CANCELA si índice y pulgar están muy cerca (pellizco)
 */
AFRAME.registerComponent('gesto-apuntar', {
    schema: {
        hand: { type: 'string', default: 'any' }, // 'left', 'right', 'any'
        indexExtendedThreshold: { type: 'number', default: 0.06 }, // MÁS PERMISIVO
        otherFingersThreshold: { type: 'number', default: 0.08 }, // MÁS PERMISIVO
        releaseThreshold: { type: 'number', default: 0.10 }, // MÁS PERMISIVO
        pinchCancelThreshold: { type: 'number', default: 0.04 }, // ✅ NUEVO: Si índice y pulgar < 4cm, cancelar
        emitEachFrame: { type: 'boolean', default: false },
        log: { type: 'boolean', default: false },
        debugDistances: { type: 'boolean', default: false }, // ✅ NUEVO: mostrar distancias cada frame
        colliderSize: { type: 'vec3', default: { x: 0.05, y: 0.05, z: 0.05 } },
        debugCollider: { type: 'boolean', default: false },
        colliderType: { type: 'string', default: 'sat-collider', oneOf: ['obb-collider', 'sat-collider'] }
    },

    init: function () {
        this.renderer = null;
        this.referenceSpace = null;
        this.state = {
            left: { pointing: false, colliderEntity: null, direction: new THREE.Vector3() },
            right: { pointing: false, colliderEntity: null, direction: new THREE.Vector3() }
        };

        // Crear colisionadores para cada mano (en la punta del dedo índice)
        ['left', 'right'].forEach(h => {
            const handState = this.state[h];
            const colliderEntity = document.createElement('a-entity');
            colliderEntity.setAttribute('id', `hand-point-collider-${h}`);

            if (this.data.colliderType === 'obb-collider') {
                colliderEntity.setAttribute('geometry', {
                    primitive: 'box',
                    width: this.data.colliderSize.x,
                    height: this.data.colliderSize.y,
                    depth: this.data.colliderSize.z
                });

                colliderEntity.setAttribute('obb-collider', {
                    trackedObject3D: 'mesh'
                });

                colliderEntity.setAttribute('material', {
                    visible: false,
                    transparent: true,
                    opacity: 0
                });

                if (this.data.debugCollider) {
                    const debugBox = document.createElement('a-box');
                    debugBox.setAttribute('width', this.data.colliderSize.x);
                    debugBox.setAttribute('height', this.data.colliderSize.y);
                    debugBox.setAttribute('depth', this.data.colliderSize.z);
                    debugBox.setAttribute('color', h === 'left' ? '#0ff' : '#f0f');
                    debugBox.setAttribute('opacity', 0.4);
                    debugBox.setAttribute('wireframe', true);
                    debugBox.setAttribute('material', 'transparent: true');
                    colliderEntity.appendChild(debugBox);
                }
            } else {
                // sat-collider
                const colliderConfig = `size: ${this.data.colliderSize.x} ${this.data.colliderSize.y} ${this.data.colliderSize.z}; debug: ${this.data.debugCollider}`;
                colliderEntity.setAttribute('sat-collider', colliderConfig);

                if (this.data.debugCollider) {
                    colliderEntity.addEventListener('componentinitialized', (evt) => {
                        if (evt.detail.name === 'sat-collider') {
                            const comp = colliderEntity.components['sat-collider'];
                            if (comp._debugBox) {
                                comp._debugBox.setAttribute('color', h === 'left' ? '#0ff' : '#f0f');
                            }
                        }
                    });
                }
            }

            this.el.sceneEl.appendChild(colliderEntity);
            handState.colliderEntity = colliderEntity;
        });

        console.log(`[gesto-apuntar] ✅ Inicializado con colisionador: ${this.data.colliderType}`);
        console.log(`[gesto-apuntar] Umbrales: índice=${this.data.indexExtendedThreshold}m, otros=${this.data.otherFingersThreshold}m, pellizco-cancel=${this.data.pinchCancelThreshold}m`);
    },

    remove: function () {
        ['left', 'right'].forEach(h => {
            const handState = this.state[h];
            if (handState.colliderEntity) {
                handState.colliderEntity.remove();
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

            // Obtener articulaciones necesarias
            const wrist = inputSource.hand.get('wrist');
            const thumbTip = inputSource.hand.get('thumb-tip'); // ✅ AHORA SÍ necesitamos el pulgar
            const indexTip = inputSource.hand.get('index-finger-tip');
            const middleTip = inputSource.hand.get('middle-finger-tip');
            const ringTip = inputSource.hand.get('ring-finger-tip');
            const pinkyTip = inputSource.hand.get('pinky-finger-tip');

            if (!wrist || !thumbTip || !indexTip || !middleTip || !ringTip || !pinkyTip) continue;

            const wristPose = frame.getJointPose(wrist, this.referenceSpace);
            const thumbPose = frame.getJointPose(thumbTip, this.referenceSpace);
            const indexPose = frame.getJointPose(indexTip, this.referenceSpace);
            const middlePose = frame.getJointPose(middleTip, this.referenceSpace);
            const ringPose = frame.getJointPose(ringTip, this.referenceSpace);
            const pinkyPose = frame.getJointPose(pinkyTip, this.referenceSpace);

            if (!wristPose || !thumbPose || !indexPose || !middlePose || !ringPose || !pinkyPose) continue;

            // Calcular centro de la palma (aproximadamente en la muñeca)
            const palmPos = wristPose.transform.position;

            // Distancias de cada dedo a la palma
            const indexDistance = this._distance(indexPose.transform.position, palmPos);
            const middleDistance = this._distance(middlePose.transform.position, palmPos);
            const ringDistance = this._distance(ringPose.transform.position, palmPos);
            const pinkyDistance = this._distance(pinkyPose.transform.position, palmPos);

            // ✅ NUEVO: Calcular distancia índice-pulgar (para detectar pellizco)
            const pinchDistance = this._distance(indexPose.transform.position, thumbPose.transform.position);

            const handState = this.state[handedness];

            // ✅ DEBUG: Mostrar distancias cada segundo
            if (this.data.debugDistances) {
                if (!this._lastDebugTime) this._lastDebugTime = 0;
                const now = Date.now();
                if (now - this._lastDebugTime > 1000) {
                    console.log(`[gesto-apuntar] ${handedness} | índice=${indexDistance.toFixed(3)}m medio=${middleDistance.toFixed(3)}m anular=${ringDistance.toFixed(3)}m meñique=${pinkyDistance.toFixed(3)}m pellizco=${pinchDistance.toFixed(3)}m`);
                    this._lastDebugTime = now;
                }
            }

            // Posicionar colisionador EN LA PUNTA DEL DEDO ÍNDICE
            const iTip = indexPose.transform.position;
            const iQuat = indexPose.transform.orientation;

            if (handState.colliderEntity) {
                handState.colliderEntity.object3D.position.set(iTip.x, iTip.y, iTip.z);
                handState.colliderEntity.object3D.quaternion.set(iQuat.x, iQuat.y, iQuat.z, iQuat.w);
            }

            // Calcular dirección de apuntado (del wrist a la punta del índice)
            handState.direction.set(
                iTip.x - palmPos.x,
                iTip.y - palmPos.y,
                iTip.z - palmPos.z
            ).normalize();

            // ✅ CANCELAR si está haciendo pellizco (índice y pulgar muy cerca)
            const isPinching = pinchDistance <= this.data.pinchCancelThreshold;

            // Detectar gesto de apuntar:
            // - Índice extendido (lejos de la palma)
            // - SOLO medio, anular y meñique cerrados
            // - ❌ NO si está haciendo pellizco
            const indexExtended = indexDistance >= this.data.indexExtendedThreshold;
            const othersClosed =
                middleDistance <= this.data.otherFingersThreshold &&
                ringDistance <= this.data.otherFingersThreshold &&
                pinkyDistance <= this.data.otherFingersThreshold;

            // Con histéresis para evitar flickering
            if (!handState.pointing && indexExtended && othersClosed && !isPinching) {
                handState.pointing = true;
                this._emit('pointstart', handedness, indexDistance, handState.direction);
            } else if (handState.pointing && (!indexExtended || !othersClosed || isPinching)) {
                // Liberar si:
                // - El índice se encoge
                // - Los otros dedos se extienden
                // - ✅ SE HACE PELLIZCO
                const indexBelowRelease = indexDistance < this.data.releaseThreshold;
                const othersNotClosed =
                    middleDistance > this.data.otherFingersThreshold ||
                    ringDistance > this.data.otherFingersThreshold ||
                    pinkyDistance > this.data.otherFingersThreshold;

                if (indexBelowRelease || othersNotClosed || isPinching) {
                    handState.pointing = false;
                    this._emit('pointend', handedness, indexDistance, handState.direction);
                }
            } else if (handState.pointing && this.data.emitEachFrame) {
                this._emit('pointmove', handedness, indexDistance, handState.direction);
            }
        }
    },

    _distance: function (pos1, pos2) {
        const dx = pos1.x - pos2.x;
        const dy = pos1.y - pos2.y;
        const dz = pos1.z - pos2.z;
        return Math.sqrt(dx * dx + dy * dy + dz * dz);
    },

    _emit: function (type, hand, distance, direction) {
        if (this.data.log) {
            console.log(`[gesto-apuntar] ${type} mano=${hand} dist-índice=${distance.toFixed(4)}m dir=(${direction.x.toFixed(2)}, ${direction.y.toFixed(2)}, ${direction.z.toFixed(2)})`);
        }
        this.el.emit(type, {
            hand,
            distance,
            direction: { x: direction.x, y: direction.y, z: direction.z }
        }, false);
    },

    getHandCollider: function (handedness) {
        const handState = this.state[handedness];
        if (!handState || !handState.colliderEntity) return null;

        if (this.data.colliderType === 'obb-collider') {
            return {
                el: handState.colliderEntity,
                getOBB: () => {
                    const pos = new THREE.Vector3();
                    const quat = new THREE.Quaternion();
                    handState.colliderEntity.object3D.getWorldPosition(pos);
                    handState.colliderEntity.object3D.getWorldQuaternion(quat);

                    return {
                        center: pos,
                        size: new THREE.Vector3(this.data.colliderSize.x, this.data.colliderSize.y, this.data.colliderSize.z),
                        halfSize: new THREE.Vector3(
                            this.data.colliderSize.x / 2,
                            this.data.colliderSize.y / 2,
                            this.data.colliderSize.z / 2
                        ),
                        quaternion: quat
                    };
                }
            };
        } else {
            return handState.colliderEntity.components['sat-collider'] || null;
        }
    },

    getHandOBB: function (handedness) {
        const collider = this.getHandCollider(handedness);
        return collider ? collider.getOBB() : null;
    },

    getPointDirection: function (handedness) {
        return this.state[handedness]?.direction || null;
    }
});

// Event listeners para feedback visual
document.addEventListener('DOMContentLoaded', () => {
    const detector = document.getElementById('detector');
    const msg = document.getElementById('pointMessage');
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
                msg.setAttribute('value', 'Apunta con el dedo índice (otros dedos cerrados)');
                msg.setAttribute('color', '#AAAAFF');
            }, autoHideMs);
        }
    }

    if (!detector) return;

    detector.addEventListener('pointstart', e => {
        console.log('[gesto-apuntar] ✅ EVENT pointstart recibido');
        setMessage(`POINT START (${e.detail.hand})`, '#00FF66', null);
    });

    detector.addEventListener('pointend', e => {
        console.log('[gesto-apuntar] ❌ EVENT pointend recibido');
        setMessage(`POINT END (${e.detail.hand})`, '#FF5555', 1200);
    });
});