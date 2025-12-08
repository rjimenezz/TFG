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
        colliderSize: {type: 'vec3', default: {x: 0.12, y: 0.08, z: 0.18}},
        debugCollider: {type: 'boolean', default: false},
        colliderType: {type: 'string', default: 'sat-collider', oneOf: ['obb-collider', 'sat-collider']}
    },

    init: function () {
        this.renderer = null;
        this.referenceSpace = null;
        this.state = {
            left:  { pinching: false, lastDistance: null, colliderEntity: null },
            right: { pinching: false, lastDistance: null, colliderEntity: null }
        };

        ['left', 'right'].forEach(h => {
            const handState = this.state[h];
            const colliderEntity = document.createElement('a-entity');
            colliderEntity.setAttribute('id', `hand-collider-${h}`);
            
            if (this.data.colliderType === 'obb-collider') {
                // PRIMERO: Crear la geometría que define el tamaño
                colliderEntity.setAttribute('geometry', {
                    primitive: 'box',
                    width: this.data.colliderSize.x,
                    height: this.data.colliderSize.y,
                    depth: this.data.colliderSize.z
                });
                
                // SEGUNDO: Configurar obb-collider SIN el parámetro size
                // (usa automáticamente el tamaño de la geometría)
                colliderEntity.setAttribute('obb-collider', {
                    trackedObject3D: 'mesh'
                });
                
                // TERCERO: Hacer la geometría invisible
                colliderEntity.setAttribute('material', { 
                    visible: false,
                    transparent: true,
                    opacity: 0
                });
                
                // Debug manual (este sí respeta el tamaño)
                if (this.data.debugCollider) {
                    const debugBox = document.createElement('a-box');
                    debugBox.setAttribute('width', this.data.colliderSize.x);
                    debugBox.setAttribute('height', this.data.colliderSize.y);
                    debugBox.setAttribute('depth', this.data.colliderSize.z);
                    debugBox.setAttribute('color', h === 'left' ? '#00f' : '#f80');
                    debugBox.setAttribute('opacity', 0.25);
                    debugBox.setAttribute('wireframe', true);
                    debugBox.setAttribute('material', 'transparent: true');
                    colliderEntity.appendChild(debugBox);
                    handState.debugBox = debugBox;
                }
            } else {
                // Usar sat-collider (SIN el parámetro type, siempre SAT puro)
                const colliderConfig = `size: ${this.data.colliderSize.x} ${this.data.colliderSize.y} ${this.data.colliderSize.z}; debug: ${this.data.debugCollider}`;
                colliderEntity.setAttribute('sat-collider', colliderConfig);
                
                if (this.data.debugCollider) {
                    colliderEntity.addEventListener('componentinitialized', (evt) => {
                        if (evt.detail.name === 'sat-collider') {
                            const comp = colliderEntity.components['sat-collider'];
                            if (comp._debugBox) {
                                comp._debugBox.setAttribute('color', h === 'left' ? '#0af' : '#fa0');
                            }
                        }
                    });
                }
            }
            
            this.el.sceneEl.appendChild(colliderEntity);
            handState.colliderEntity = colliderEntity;
        });

        console.log(`[gesto-pellizco] Usando colisionador: ${this.data.colliderType}`);
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

            const dx = thumbPose.transform.position.x - indexPose.transform.position.x;
            const dy = thumbPose.transform.position.y - indexPose.transform.position.y;
            const dz = thumbPose.transform.position.z - indexPose.transform.position.z;
            const distance = Math.sqrt(dx*dx + dy*dy + dz*dz);

            const handState = this.state[handedness];
            handState.lastDistance = distance;

            const wPos = wristPose.transform.position;
            const mPos = middleTipPose.transform.position;
            const centerX = (wPos.x + mPos.x) / 2;
            const centerY = (wPos.y + mPos.y) / 2;
            const centerZ = (wPos.z + mPos.z) / 2;

            const wQuat = wristPose.transform.orientation;

            if (handState.colliderEntity) {
                handState.colliderEntity.object3D.position.set(centerX, centerY, centerZ);
                handState.colliderEntity.object3D.quaternion.set(wQuat.x, wQuat.y, wQuat.z, wQuat.w);
            }

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
            console.log(`[gesto-pellizco] ${type} mano=${hand} dist=${distance.toFixed(4)}m`);
        }
        this.el.emit(type, { hand, distance }, false);
    },

    getHandCollider: function(handedness) {
        const handState = this.state[handedness];
        if (!handState || !handState.colliderEntity) return null;
        
        if (this.data.colliderType === 'obb-collider') {
            // Wrapper para obb-collider nativo
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
            // sat-collider
            return handState.colliderEntity.components['sat-collider'] || null;
        }
    },

    getHandOBB: function(handedness) {
        const collider = this.getHandCollider(handedness);
        return collider ? collider.getOBB() : null;
    }
});

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
        setMessage(`PINCH START (${e.detail.hand})`, '#00FF66', null);
    });

    detector.addEventListener('pinchend', e => {
        setMessage(`PINCH END (${e.detail.hand})`, '#FF5555', 1200);
    });
});