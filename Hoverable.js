/**
 * Componente: hoverable
 * Indica cuando una mano está cerca del objeto añadiendo el estado 'hovered'.
 * Compatible con obb-collider (nativo de A-Frame) y sat-collider (personalizado).
 * 
 * Estados:
 * - 'hovered': Se añade mientras una o ambas manos están en contacto con el objeto
 * 
 * Eventos:
 * - 'hover-start': { hand, hands } - Una mano entra en contacto
 * - 'hovering': { hands } - Cada frame mientras hay contacto (si emitEachFrame: true)
 * - 'hover-end': { hand, hands } - Una mano sale del contacto
 */
AFRAME.registerComponent('hoverable', {
    schema: {
        debug: { type: 'boolean', default: false },
        emitEachFrame: { type: 'boolean', default: false },
        colliderSize: { type: 'vec3', default: { x: 0.3, y: 0.3, z: 0.3 } }
    },

    init: function () {
        this.sceneEl = this.el.sceneEl;

        if (this.sceneEl.hasLoaded) {
            this._setup();
        } else {
            this.sceneEl.addEventListener('loaded', () => this._setup());
        }
    },

    _setup: function () {
        this.detectors = this._findDetectors();

        if (this.detectors.length === 0) {
            console.warn('[hoverable] No se encontraron detectores de gestos.');
            return;
        }

        this.colliderType = this._detectColliderType();

        this.inContact = { left: false, right: false };
        this.wasHovered = false;

        this._ensureCollider();

        // ✅ Event listeners para obb-collider nativo
        if (this.colliderType === 'obb-collider') {
            this._onOBBCollisionStart = this._onOBBCollisionStart.bind(this);
            this._onOBBCollisionEnd = this._onOBBCollisionEnd.bind(this);

            this.el.addEventListener('obbcollisionstarted', this._onOBBCollisionStart);
            this.el.addEventListener('obbcollisionended', this._onOBBCollisionEnd);
        }

        console.log(`[hoverable] ✅ Inicializado en ${this.el.id || this.el.tagName}`);
        console.log(`  - Detectores encontrados: ${this.detectors.length}`);
        console.log(`  - Colisionador heredado: ${this.colliderType}`);
    },

    _findDetectors: function () {
        const detectors = [];
        const entities = this.sceneEl.querySelectorAll('a-entity');

        for (let entity of entities) {
            if (entity.components['gesto-pellizco'] || entity.components['gesto-apuntar']) {
                detectors.push(entity);
            }
        }

        return detectors;
    },

    _detectColliderType: function () {
        for (let detector of this.detectors) {
            const gestoComp = detector.components['gesto-pellizco'] ||
                detector.components['gesto-apuntar'];

            if (gestoComp?.data.colliderType) {
                const detectedType = gestoComp.data.colliderType;
                console.log(`[hoverable] 🔍 Colisionador detectado: ${detectedType}`);
                return detectedType;
            }
        }
        return 'sat-collider'; // Default
    },

    remove: function () {
        if (this.colliderType === 'obb-collider') {
            this.el.removeEventListener('obbcollisionstarted', this._onOBBCollisionStart);
            this.el.removeEventListener('obbcollisionended', this._onOBBCollisionEnd);
        }

        if (this.el.is('hovered')) {
            this.el.removeState('hovered');
        }

        this.el.removeAttribute(this.colliderType);
    },

    _ensureCollider: function () {
        const hasCollider = this.el.components['sat-collider'] || this.el.components['obb-collider'];

        if (!hasCollider) {
            let size = this.data.colliderSize;

            const geometry = this.el.getAttribute('geometry');
            if (geometry?.primitive === 'box') {
                size = {
                    x: geometry.width || 1,
                    y: geometry.height || 1,
                    z: geometry.depth || 1
                };
            } else if (geometry?.primitive === 'sphere') {
                const r = (geometry.radius || 0.5) * 2;
                size = { x: r, y: r, z: r };
            }

            console.log(`[hoverable] ➕ Añadiendo ${this.colliderType} con tamaño:`, size);

            if (this.colliderType === 'obb-collider') {
                // ✅ OBB-collider nativo
                if (!geometry) {
                    this.el.setAttribute('geometry', {
                        primitive: 'box',
                        width: size.x,
                        height: size.y,
                        depth: size.z
                    });
                }

                this.el.setAttribute('obb-collider', {
                    trackedObject3D: 'mesh'
                });

                const existingMaterial = this.el.getAttribute('material');
                if (!existingMaterial || existingMaterial.visible === false) {
                    if (this.data.debug) {
                        this.el.setAttribute('material', {
                            color: '#ff0',
                            opacity: 0.2,
                            transparent: true,
                            wireframe: true
                        });
                    } else {
                        this.el.setAttribute('material', {
                            visible: false,
                            transparent: true,
                            opacity: 0
                        });
                    }
                }
            } else {
                // SAT-collider personalizado
                const colliderConfig = `size: ${size.x} ${size.y} ${size.z}; debug: ${this.data.debug}`;
                this.el.setAttribute('sat-collider', colliderConfig);
            }
        } else {
            console.log(`[hoverable] ✓ Ya tiene colisionador: ${hasCollider.name}`);
        }
    },

    // ✅ Handlers para obb-collider nativo
    _onOBBCollisionStart: function (e) {
        const collidedWith = e.detail.withEl;
        if (collidedWith?.id.startsWith('hand-collider-') || collidedWith?.id.startsWith('hand-point-collider-')) {
            const hand = collidedWith.id.includes('left') ? 'left' : 'right';

            if (!this.inContact[hand]) {
                this.inContact[hand] = true;
                this._updateHoverState(hand, 'start');
                console.log(`[hoverable] 🟢 HOVER START - Mano ${hand} (OBB evento)`);
            }
        }
    },

    _onOBBCollisionEnd: function (e) {
        const collidedWith = e.detail.withEl;
        if (collidedWith?.id.startsWith('hand-collider-') || collidedWith?.id.startsWith('hand-point-collider-')) {
            const hand = collidedWith.id.includes('left') ? 'left' : 'right';

            if (this.inContact[hand]) {
                this.inContact[hand] = false;
                this._updateHoverState(hand, 'end');
                console.log(`[hoverable] 🔴 HOVER END - Mano ${hand} (OBB evento)`);
            }
        }
    },

    tick: function () {
        if (this.detectors.length === 0) return;

        // ✅ Detección manual solo para SAT-collider
        if (this.colliderType === 'sat-collider') {
            const objectCollider = this.el.components['sat-collider'];
            if (!objectCollider) return;

            ['left', 'right'].forEach(hand => {
                const wasInContact = this.inContact[hand];
                let currentContact = false;

                // Buscar en todos los detectores
                for (let detector of this.detectors) {
                    const gestoComp = detector.components['gesto-pellizco'] ||
                        detector.components['gesto-apuntar'];

                    if (gestoComp?.getHandCollider) {
                        const handCollider = gestoComp.getHandCollider(hand);

                        if (handCollider) {
                            const objectOBB = objectCollider.getOBB();
                            if (handCollider.testCollision(objectOBB)) {
                                currentContact = true;
                                break;
                            }
                        }
                    }
                }

                this.inContact[hand] = currentContact;

                if (currentContact && !wasInContact) {
                    this._updateHoverState(hand, 'start');
                    console.log(`[hoverable] 🟢 HOVER START - Mano ${hand} (SAT manual)`);
                } else if (!currentContact && wasInContact) {
                    this._updateHoverState(hand, 'end');
                    console.log(`[hoverable] 🔴 HOVER END - Mano ${hand} (SAT manual)`);
                }
            });
        }

        // Emitir evento 'hovering' cada frame si está configurado
        if (this.data.emitEachFrame && this.el.is('hovered')) {
            const hands = this._getHoveringHands();
            this.el.emit('hovering', { hands }, false);
        }
    },

    _updateHoverState: function (hand, type) {
        const hands = this._getHoveringHands();
        const isHovered = hands.length > 0;

        if (type === 'start') {
            if (!this.wasHovered) {
                this.el.addState('hovered');
                this.wasHovered = true;
            }
            this.el.emit('hover-start', { hand, hands }, false);
        } else if (type === 'end') {
            this.el.emit('hover-end', { hand, hands }, false);

            if (!isHovered && this.wasHovered) {
                this.el.removeState('hovered');
                this.wasHovered = false;
            }
        }
    },

    _getHoveringHands: function () {
        const hands = [];
        if (this.inContact.left) hands.push('left');
        if (this.inContact.right) hands.push('right');
        return hands;
    }
});