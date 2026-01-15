/**
 * Componente: clickable
 * Detecta clicks con gestos de mano SIN mover el objeto.
 * Por defecto usa gesto de apuntar, pero se puede configurar para pellizco.
 * NO usar clickable y grabbable en la misma entidad.
 */
AFRAME.registerComponent('clickable', {
    schema: {
        maxClickers: { type: 'int', default: NaN },
        colliderSize: { type: 'vec3', default: { x: 0.3, y: 0.3, z: 0.3 } },
        debug: { type: 'boolean', default: false },
        // ✅ Elegir qué gesto usar para click
        startGesture: { type: 'string', default: 'pointstart' },  // 'pointstart' o 'pinchstart'
        endGesture: { type: 'string', default: 'pointend' }       // 'pointend' o 'pinchend'
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
        this.detector = this._findDetector();

        if (!this.detector) {
            console.warn('[clickable] No se encontró detector compatible. Creando detector automático con gesto-apuntar...');
            this._createDetector();
        }

        this.colliderType = this._detectColliderType();

        this.clickers = [];
        this.inContact = { left: false, right: false };
        this.isGesturing = { left: false, right: false };

        this._ensureCollider();

        this._onGestureStart = this._onGestureStart.bind(this);
        this._onGestureEnd = this._onGestureEnd.bind(this);
        this._onGestureMove = this._onGestureMove.bind(this);

        this.detector.addEventListener(this.data.startGesture, this._onGestureStart);
        this.detector.addEventListener(this.data.endGesture, this._onGestureEnd);

        // ✅ NUEVO: Escuchar eventos de movimiento para detectar contacto durante gesto
        const moveEvent = this.data.startGesture.replace('start', 'move');
        this.detector.addEventListener(moveEvent, this._onGestureMove);

        const maxClickersText = isNaN(this.data.maxClickers) ? 'ilimitado' : this.data.maxClickers;
        console.log(`[clickable] ✅ Inicializado en ${this.el.id || this.el.tagName}`);
        console.log(`  - Colisionador: ${this.colliderType}`);
        console.log(`  - maxClickers: ${maxClickersText}`);
        console.log(`  - startGesture: ${this.data.startGesture}`);
        console.log(`  - endGesture: ${this.data.endGesture}`);
    },

    _findDetector: function () {
        const needsPinch = this.data.startGesture === 'pinchstart' || this.data.startGesture === 'pinchmove';
        const needsPoint = this.data.startGesture === 'pointstart' || this.data.startGesture === 'pointmove';

        let detector = document.getElementById('detector-clickable');
        if (detector) {
            if (needsPinch && detector.components['gesto-pellizco']) return detector;
            if (needsPoint && detector.components['gesto-apuntar']) return detector;
        }

        // ✅ NUEVO: Buscar detector-apuntar por ID
        detector = document.getElementById('detector-apuntar');
        if (detector) {
            if (needsPoint && detector.components['gesto-apuntar']) return detector;
        }

        detector = document.getElementById('detector-pellizco');
        if (detector) {
            if (needsPinch && detector.components['gesto-pellizco']) return detector;
        }

        detector = document.getElementById('detector');
        if (detector) {
            if (needsPinch && detector.components['gesto-pellizco']) return detector;
            if (needsPoint && detector.components['gesto-apuntar']) return detector;
        }

        const entities = this.sceneEl.querySelectorAll('a-entity');
        for (let entity of entities) {
            if (needsPinch && entity.components['gesto-pellizco']) return entity;
            if (needsPoint && entity.components['gesto-apuntar']) return entity;
        }

        return null;
    },

    _detectColliderType: function () {
        const gestoComp = this.detector.components['gesto-pellizco'] ||
            this.detector.components['gesto-apuntar'];

        return gestoComp && gestoComp.data.colliderType ? gestoComp.data.colliderType : 'sat-collider';
    },

    _createDetector: function () {
        console.log('[clickable] Creando detector automático con gesto-apuntar...');

        const detector = document.createElement('a-entity');
        detector.setAttribute('id', 'detector-clickable');
        detector.setAttribute('gesto-apuntar', {
            hand: 'any',
            indexExtendedThreshold: 0.06,
            otherFingersThreshold: 0.08,
            releaseThreshold: 0.10,
            pinchCancelThreshold: 0.04,
            emitEachFrame: true,
            debugCollider: false,
            colliderType: 'sat-collider'
        });

        this.sceneEl.appendChild(detector);
        this.detector = detector;

        const manos = document.createElement('a-entity');
        manos.setAttribute('manos-esferas', {
            useJointRadius: true,
            colorLeft: '#39f',
            colorRight: '#f93',
            opacity: 0.7,
            labels: false
        });
        this.sceneEl.appendChild(manos);
    },

    remove: function () {
        if (this.detector) {
            this.detector.removeEventListener(this.data.startGesture, this._onGestureStart);
            this.detector.removeEventListener(this.data.endGesture, this._onGestureEnd);
            const moveEvent = this.data.startGesture.replace('start', 'move');
            this.detector.removeEventListener(moveEvent, this._onGestureMove);
        }

        while (this.clickers.length > 0) {
            this._releaseClick(this.clickers[0].hand);
        }

        if (this.el.is('clicked')) {
            this.el.removeState('clicked');
            console.log(`[clickable] ❌ Estado 'clicked' eliminado (componente removido)`);
        }
    },

    _ensureCollider: function () {
        const hasCollider = this.el.components['sat-collider'] || this.el.components['obb-collider'];

        if (!hasCollider) {
            let size = this.data.colliderSize;

            const geometry = this.el.getAttribute('geometry');
            if (geometry) {
                if (geometry.primitive === 'box') {
                    size = {
                        x: geometry.width || 1,
                        y: geometry.height || 1,
                        z: geometry.depth || 1
                    };
                } else if (geometry.primitive === 'sphere') {
                    const r = (geometry.radius || 0.5) * 2;
                    size = { x: r, y: r, z: r };
                }
            }

            console.log(`[clickable] Añadiendo ${this.colliderType} con tamaño:`, size);

            const colliderConfig = `size: ${size.x} ${size.y} ${size.z}; debug: ${this.data.debug}`;
            this.el.setAttribute(this.colliderType, colliderConfig);
        }
    },

    tick: function () {
        if (!this.detector) return;

        const gestoComp = this.detector.components['gesto-pellizco'] ||
            this.detector.components['gesto-apuntar'];

        if (!gestoComp || !gestoComp.getHandCollider) return;

        if (this.colliderType === 'sat-collider') {
            const objectCollider = this.el.components['sat-collider'];
            if (!objectCollider) return;

            ['left', 'right'].forEach(h => {
                const handCollider = gestoComp.getHandCollider(h);

                if (handCollider) {
                    const wasInContact = this.inContact[h];
                    const objectOBB = objectCollider.getOBB();
                    this.inContact[h] = handCollider.testCollision(objectOBB);

                    if (this.inContact[h] && !wasInContact) {
                        console.log(`[clickable] 🟢 Contacto con mano ${h}`);

                        // ✅ NUEVO: Si ya está haciendo el gesto Y entra en contacto → iniciar click
                        if (this.isGesturing[h]) {
                            const alreadyClicking = this.clickers.findIndex(c => c.hand === h) !== -1;
                            if (!alreadyClicking) {
                                const hasLimit = !isNaN(this.data.maxClickers);
                                const belowLimit = !hasLimit || this.clickers.length < this.data.maxClickers;
                                if (belowLimit) {
                                    console.log(`[clickable] 🎯 Click iniciado por contacto (ya estaba apuntando con ${h})`);
                                    this._startClick(h);
                                }
                            }
                        }
                    } else if (!this.inContact[h] && wasInContact) {
                        console.log(`[clickable] 🔴 Perdió contacto con mano ${h}`);
                    }
                } else {
                    this.inContact[h] = false;
                }
            });
        }

        // Verificar clicks activos
        for (let i = this.clickers.length - 1; i >= 0; i--) {
            const clicker = this.clickers[i];
            if (!this.inContact[clicker.hand] || !this.isGesturing[clicker.hand]) {
                this._releaseClick(clicker.hand);
            }
        }
    },

    _onGestureStart: function (e) {
        const hand = e.detail && e.detail.hand;
        if (!hand) return;

        this.isGesturing[hand] = true;
        console.log(`[clickable] 👉 Gesto ${this.data.startGesture} iniciado con mano ${hand}`);

        const hasLimit = !isNaN(this.data.maxClickers);
        const belowLimit = !hasLimit || this.clickers.length < this.data.maxClickers;

        // Caso 1: Ya está en contacto → iniciar click
        if (this.inContact[hand] && belowLimit) {
            this._startClick(hand);
        }
    },

    // ✅ NUEVO: Manejar eventos de movimiento durante el gesto
    _onGestureMove: function (e) {
        const hand = e.detail && e.detail.hand;
        if (!hand) return;

        // Ya está manejado en tick(), pero mantenemos el estado actualizado
        this.isGesturing[hand] = true;
    },

    _onGestureEnd: function (e) {
        const hand = e.detail && e.detail.hand;
        if (!hand) return;

        this.isGesturing[hand] = false;
        console.log(`[clickable] 🚫 Gesto ${this.data.endGesture} finalizado con mano ${hand}`);

        const clickerIndex = this.clickers.findIndex(c => c.hand === hand);
        if (clickerIndex !== -1) {
            this._releaseClick(hand);
        }
    },

    _startClick: function (hand) {
        const gestoComp = this.detector.components['gesto-pellizco'] ||
            this.detector.components['gesto-apuntar'];

        const handCollider = gestoComp.getHandCollider(hand);
        if (!handCollider) return;

        // ✅ Prevenir clicks duplicados
        const alreadyClicking = this.clickers.findIndex(c => c.hand === hand) !== -1;
        if (alreadyClicking) {
            console.log(`[clickable] ⚠️ Mano ${hand} ya está haciendo click, ignorando`);
            return;
        }

        const wasClicked = this.clickers.length > 0;

        if (!isNaN(this.data.maxClickers) && this.clickers.length >= this.data.maxClickers) {
            const oldestClicker = this.clickers[0];
            console.log(`[clickable] Máximo de clicks alcanzado (${this.data.maxClickers}), soltando mano ${oldestClicker.hand}`);
            this._releaseClick(oldestClicker.hand);
        }

        const clickData = {
            hand: hand,
            startTime: Date.now()
        };

        this.clickers.push(clickData);

        if (!wasClicked) {
            this.el.addState('clicked');
            console.log(`[clickable] 🖱️ Estado 'clicked' AÑADIDO`);
        }

        console.log(`[clickable] 🎯 CLICK INICIADO por mano ${hand} con gesto '${this.data.startGesture}' (total: ${this.clickers.length})`);
        this.el.emit('click-start', { hand, clickers: this.clickers.length, gesture: this.data.startGesture }, false);
    },

    _releaseClick: function (hand) {
        const clickerIndex = this.clickers.findIndex(c => c.hand === hand);
        if (clickerIndex === -1) return;

        const clickData = this.clickers[clickerIndex];
        const duration = Date.now() - clickData.startTime;

        this.clickers.splice(clickerIndex, 1);

        if (this.clickers.length === 0) {
            this.el.removeState('clicked');
            console.log(`[clickable] 🖱️ Estado 'clicked' ELIMINADO`);
        }

        console.log(`[clickable] 🔓 CLICK FINALIZADO por mano ${hand} con gesto '${this.data.endGesture}' (duración: ${duration}ms, restantes: ${this.clickers.length})`);
        this.el.emit('click-end', { hand, clickers: this.clickers.length, duration, gesture: this.data.endGesture }, false);
    }
});