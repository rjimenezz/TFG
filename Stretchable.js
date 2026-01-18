/**
 * Componente: stretchable
 * Permite escalar un objeto con dos manos mientras está agarrado.
 * Compatible con grabbable - usa ambas manos para escalar.
 * NO incluye física.
 */
AFRAME.registerComponent('stretchable', {
    schema: {
        invert: { type: 'boolean', default: false },
        minScale: { type: 'number', default: 0.1 },
        maxScale: { type: 'number', default: 10.0 },
        // ✅ Elegir qué gesto usar (debe coincidir con grabbable)
        startGesture: { type: 'string', default: 'pinchstart' },  // 'pinchstart' o 'pointstart'
        endGesture: { type: 'string', default: 'pinchend' }       // 'pinchend' o 'pointend'
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
        // ✅ Buscar detector según el gesto configurado
        this.detector = this._findDetector();

        if (!this.detector) {
            console.warn('[stretchable] No se encontró detector compatible. Usa el mismo detector que grabbable.');
            return;
        }

        this.stretchers = []; // Manos activas en stretch
        this.initialDistance = null;
        this.initialScale = null;
        this.isStretching = false;

        this._onGestureStart = this._onGestureStart.bind(this);
        this._onGestureEnd = this._onGestureEnd.bind(this);

        this.detector.addEventListener(this.data.startGesture, this._onGestureStart);
        this.detector.addEventListener(this.data.endGesture, this._onGestureEnd);

        console.log(`[stretchable] ✅ Inicializado en ${this.el.id || this.el.tagName}`);
        console.log(`  - invert: ${this.data.invert}`);
        console.log(`  - minScale: ${this.data.minScale}`);
        console.log(`  - maxScale: ${this.data.maxScale}`);
        console.log(`  - startGesture: ${this.data.startGesture}`);
    },

    /**
     * ✅ Busca el detector apropiado (igual que grabbable)
     */
    _findDetector: function () {
        const needsPinch = this.data.startGesture === 'pinchstart' || this.data.startGesture === 'pinchmove';
        const needsPoint = this.data.startGesture === 'pointstart' || this.data.startGesture === 'pointmove';

        let detector = document.getElementById('detector');
        if (detector) {
            if (needsPinch && detector.components['gesto-pellizco']) return detector;
            if (needsPoint && detector.components['gesto-apuntar']) return detector;
        }

        detector = document.getElementById('detector-apuntar');
        if (detector && needsPoint && detector.components['gesto-apuntar']) return detector;

        detector = document.getElementById('detector-pellizco');
        if (detector && needsPinch && detector.components['gesto-pellizco']) return detector;

        const entities = this.sceneEl.querySelectorAll('a-entity');
        for (let entity of entities) {
            if (needsPinch && entity.components['gesto-pellizco']) return entity;
            if (needsPoint && entity.components['gesto-apuntar']) return entity;
        }

        return null;
    },

    remove: function () {
        if (this.detector) {
            this.detector.removeEventListener(this.data.startGesture, this._onGestureStart);
            this.detector.removeEventListener(this.data.endGesture, this._onGestureEnd);
        }

        if (this.el.is('stretched')) {
            this.el.removeState('stretched');
        }
    },

    tick: function () {
        if (!this.detector || !this.isStretching || this.stretchers.length < 2) return;

        const gestoComp = this.detector.components['gesto-pellizco'] ||
            this.detector.components['gesto-apuntar'];

        if (!gestoComp) return;

        // Obtener posiciones de las dos manos
        const hand1 = this.stretchers[0];
        const hand2 = this.stretchers[1];

        const collider1 = gestoComp.state[hand1].colliderEntity;
        const collider2 = gestoComp.state[hand2].colliderEntity;

        if (!collider1 || !collider2) return;

        const pos1 = new THREE.Vector3();
        const pos2 = new THREE.Vector3();

        collider1.object3D.getWorldPosition(pos1);
        collider2.object3D.getWorldPosition(pos2);

        // Calcular distancia actual entre manos
        const currentDistance = pos1.distanceTo(pos2);

        if (this.initialDistance === null) {
            this.initialDistance = currentDistance;
            this.initialScale = this.el.object3D.scale.clone();
            console.log(`[stretchable] 📏 Distancia inicial: ${this.initialDistance.toFixed(3)}m`);
            return;
        }

        // Calcular factor de escala
        let scaleFactor = currentDistance / this.initialDistance;

        // ✅ Invertir si está configurado
        if (this.data.invert) {
            scaleFactor = 1 / scaleFactor;
        }

        // Aplicar escala con límites
        const newScale = this.initialScale.clone().multiplyScalar(scaleFactor);

        newScale.x = THREE.MathUtils.clamp(newScale.x, this.data.minScale, this.data.maxScale);
        newScale.y = THREE.MathUtils.clamp(newScale.y, this.data.minScale, this.data.maxScale);
        newScale.z = THREE.MathUtils.clamp(newScale.z, this.data.minScale, this.data.maxScale);

        this.el.object3D.scale.copy(newScale);

        // Emitir evento cada frame si hay cambio significativo
        const scaleChange = Math.abs(scaleFactor - 1.0);
        if (scaleChange > 0.01) {
            this.el.emit('stretch', {
                scale: newScale.clone(),
                scaleFactor: scaleFactor,
                distance: currentDistance,
                hands: [hand1, hand2]
            }, false);
        }
    },

    _onGestureStart: function (e) {
        const hand = e.detail && e.detail.hand;
        if (!hand) return;

        // Solo nos importa si el objeto YA está siendo agarrado
        if (!this.el.is('grabbed')) return;

        // Añadir mano al array de stretchers
        if (!this.stretchers.includes(hand)) {
            this.stretchers.push(hand);
            console.log(`[stretchable] ✋ Mano ${hand} añadida (total: ${this.stretchers.length})`);
        }

        // Si ahora hay 2 manos, iniciar stretch
        if (this.stretchers.length === 2 && !this.isStretching) {
            this._startStretch();
        }
    },

    _onGestureEnd: function (e) {
        const hand = e.detail && e.detail.hand;
        if (!hand) return;

        const index = this.stretchers.indexOf(hand);
        if (index !== -1) {
            this.stretchers.splice(index, 1);
            console.log(`[stretchable] 🚫 Mano ${hand} eliminada (restantes: ${this.stretchers.length})`);
        }

        // Si quedan menos de 2 manos, detener stretch
        if (this.stretchers.length < 2 && this.isStretching) {
            this._endStretch();
        }
    },

    _startStretch: function () {
        this.isStretching = true;
        this.initialDistance = null; // Se calculará en el próximo tick
        this.initialScale = this.el.object3D.scale.clone();

        this.el.addState('stretched');

        console.log(`[stretchable] 🔀 STRETCH INICIADO con manos: ${this.stretchers.join(', ')}`);
        this.el.emit('stretch-start', {
            hands: [...this.stretchers],
            initialScale: this.initialScale.clone(),
            gesture: this.data.startGesture
        }, false);
    },

    _endStretch: function () {
        this.isStretching = false;
        this.initialDistance = null;

        const finalScale = this.el.object3D.scale.clone();
        const scaleChange = finalScale.clone().divide(this.initialScale);

        this.el.removeState('stretched');

        console.log(`[stretchable] 🔚 STRETCH FINALIZADO. Escala final: (${finalScale.x.toFixed(2)}, ${finalScale.y.toFixed(2)}, ${finalScale.z.toFixed(2)})`);
        this.el.emit('stretch-end', {
            finalScale: finalScale,
            scaleChange: scaleChange,
            gesture: this.data.endGesture
        }, false);

        this.initialScale = null;
    }
});