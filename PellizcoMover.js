AFRAME.registerComponent('pinch-move', {
  schema: {
    hand:   { type: 'string', default: 'any' },   // 'left' | 'right' | 'any'
    radius: { type: 'number', default: 0.15 },    // metros para considerar que el pellizco está "sobre" el objeto
    rotateMode: { type: 'string', default: 'yaw' }, // 'none' | 'yaw' | 'full'
    debug:  { type: 'boolean', default: false }
  },

  init: function () {
    this.sceneEl = this.el.sceneEl;
    this.renderer = (this.sceneEl && this.sceneEl.renderer) || null;
    this.referenceSpace = null;

    // Estado de agarre
    this.grabbing = false;
    this.grabHand = null;

    // Vectores y cuaterniones temporales
    this.grabOffset = new THREE.Vector3();     // offset OBJETO - pellizco (en mundo, al iniciar)
    this.tmpWorldPos = new THREE.Vector3();
    this.tmpTarget   = new THREE.Vector3();

    // Datos de rotación
    this.startDir = new THREE.Vector3();       // dirección (index - thumb) al iniciar (en mundo, normalizada)
    this.currDir  = new THREE.Vector3();
    this.startYaw = 0;                         // yaw inicial (si rotateMode='yaw')

    this.startWorldQuat = new THREE.Quaternion();   // orientación del objeto en mundo al iniciar
    this.parentWorldQuat = new THREE.Quaternion();  // orientación del padre en mundo
    this.parentWorldQuatInv = new THREE.Quaternion();
    this.qDelta = new THREE.Quaternion();      // rotación delta (mundo)
    this.qYaw   = new THREE.Quaternion();      // delta yaw (mundo)
    this.newWorldQuat = new THREE.Quaternion();
    this.newLocalQuat = new THREE.Quaternion();

    if (this.data.debug) {
      this._debugSphere = document.createElement('a-sphere');
      this._debugSphere.setAttribute('radius', this.data.radius);
      this._debugSphere.setAttribute('color', '#8844ff');
      this._debugSphere.setAttribute('opacity', 0.15);
      this._debugSphere.setAttribute('segments-width', 12);
      this._debugSphere.setAttribute('segments-height', 8);
      this.el.appendChild(this._debugSphere);
    }

    // Detector de pellizco global
    this.detector = document.getElementById('detector');
    if (!this.detector) {
      console.warn('[pinch-move] No se encontró #detector en el DOM. Añade <a-entity id="detector" gesto-pellizco> en la escena.');
      return;
    }

    this._onPinchStart = this._onPinchStart.bind(this);
    this._onPinchMove  = this._onPinchMove.bind(this);
    this._onPinchEnd   = this._onPinchEnd.bind(this);

    this.detector.addEventListener('pinchstart', this._onPinchStart);
    this.detector.addEventListener('pinchmove',  this._onPinchMove);
    this.detector.addEventListener('pinchend',   this._onPinchEnd);
  },

  remove: function () {
    if (this.detector) {
      this.detector.removeEventListener('pinchstart', this._onPinchStart);
      this.detector.removeEventListener('pinchmove',  this._onPinchMove);
      this.detector.removeEventListener('pinchend',   this._onPinchEnd);
    }
    if (this._debugSphere) this._debugSphere.remove();
  },

  _matchHand: function (hand) {
    return this.data.hand === 'any' || this.data.hand === hand;
  },

  // Devuelve datos del pellizco en mundo: { mid, thumb, index, dir }
  _getPinchData: function (handedness) {
    const sceneEl = this.sceneEl;
    const renderer = sceneEl && sceneEl.renderer;
    if (!renderer) return null;

    const session = renderer.xr.getSession();
    const frame   = sceneEl.frame;
    if (!session || !frame) return null;

    if (!this.referenceSpace) {
      this.referenceSpace = renderer.xr.getReferenceSpace();
      if (!this.referenceSpace) return null;
    }

    for (const inputSource of session.inputSources) {
      if (!inputSource.hand) continue;
      if (inputSource.handedness !== handedness) continue;

      const thumbJoint = inputSource.hand.get('thumb-tip');
      const indexJoint = inputSource.hand.get('index-finger-tip');
      if (!thumbJoint || !indexJoint) continue;

      const thumbPose = frame.getJointPose(thumbJoint, this.referenceSpace);
      const indexPose = frame.getJointPose(indexJoint, this.referenceSpace);
      if (!thumbPose || !indexPose) continue;

      const tx = thumbPose.transform.position.x;
      const ty = thumbPose.transform.position.y;
      const tz = thumbPose.transform.position.z;
      const ix = indexPose.transform.position.x;
      const iy = indexPose.transform.position.y;
      const iz = indexPose.transform.position.z;

      const thumb = new THREE.Vector3(tx, ty, tz);
      const index = new THREE.Vector3(ix, iy, iz);
      const mid   = new THREE.Vector3().addVectors(thumb, index).multiplyScalar(0.5);
      const dir   = new THREE.Vector3().subVectors(index, thumb).normalize(); // dirección pinza

      return { mid, thumb, index, dir };
    }

    return null;
  },

  _onPinchStart: function (e) {
    const hand = e.detail && e.detail.hand;
    if (!hand) return;
    if (!this._matchHand(hand)) return;

    const data = this._getPinchData(hand);
    if (!data) return;

    // Comprobar distancia del pellizco al centro del objeto (en mundo)
    this.el.object3D.getWorldPosition(this.tmpWorldPos);
    const dist = this.tmpWorldPos.distanceTo(data.mid);
    if (dist > this.data.radius) return; // demasiado lejos del objeto

    // Guardar estado de "agarre"
    this.grabbing = true;
    this.grabHand = hand;

    // Offset inicial en mundo entre centro objeto y punto de pellizco
    this.grabOffset.copy(this.tmpWorldPos).sub(data.mid);

    // Dirección inicial de la pinza y yaw
    this.startDir.copy(data.dir);
    this.startYaw = Math.atan2(this.startDir.x, this.startDir.z); // proyección en XZ

    // Orientación inicial del objeto en mundo (y del padre)
    this.el.object3D.getWorldQuaternion(this.startWorldQuat);
    const parent = this.el.object3D.parent;
    if (parent) {
      parent.getWorldQuaternion(this.parentWorldQuat);
    } else {
      this.parentWorldQuat.identity();
    }
    this.parentWorldQuatInv.copy(this.parentWorldQuat).invert();

    this.el.emit('pinchmoverstart', { hand, distance: dist }, false);
  },

  _onPinchMove: function (e) {
    if (!this.grabbing) return;
    const hand = e.detail && e.detail.hand;
    if (hand !== this.grabHand) return;

    const data = this._getPinchData(hand);
    if (!data) return;

    // Calcular rotación delta en mundo según modo
    let qDeltaWorld = null;

    if (this.data.rotateMode === 'full') {
      // Alinear startDir -> currDir (en mundo)
      this.currDir.copy(data.dir);
      this.qDelta.setFromUnitVectors(this.startDir, this.currDir);
      qDeltaWorld = this.qDelta;

    } else if (this.data.rotateMode === 'yaw') {
      // Solo yaw alrededor de Y (mundo)
      this.currDir.copy(data.dir);
      const currYaw = Math.atan2(this.currDir.x, this.currDir.z);
      const deltaYaw = currYaw - this.startYaw;
      this.qYaw.setFromAxisAngle(new THREE.Vector3(0, 1, 0), deltaYaw);
      qDeltaWorld = this.qYaw;

    } else {
      // Sin rotación
      qDeltaWorld = new THREE.Quaternion(); // identidad
    }

    // Posición objetivo en mundo:
    // mantener el "punto de agarre" constante relativo al objeto aplicando la misma rotación al offset
    const rotatedOffset = this.grabOffset.clone().applyQuaternion(qDeltaWorld);
    this.tmpTarget.copy(data.mid).add(rotatedOffset);

    // Convertir posición objetivo a espacio local del padre
    const parent = this.el.object3D.parent;
    if (parent) parent.worldToLocal(this.tmpTarget);
    this.el.object3D.position.copy(this.tmpTarget);

    // Orientación objetivo en local (respetando transform del padre)
    // newWorldQuat = qDeltaWorld * startWorldQuat
    this.newWorldQuat.multiplyQuaternions(qDeltaWorld, this.startWorldQuat);
    // newLocalQuat = parentWorldQuatInv * newWorldQuat
    this.newLocalQuat.multiplyQuaternions(this.parentWorldQuatInv, this.newWorldQuat);
    if (this.data.rotateMode !== 'none') {
      this.el.object3D.quaternion.copy(this.newLocalQuat);
    }

    this.el.emit('pinchmovermove', {
      hand,
      position: this.tmpTarget.clone(),
      rotateMode: this.data.rotateMode
    }, false);
  },

  _onPinchEnd: function (e) {
    const hand = e.detail && e.detail.hand;
    if (!this.grabbing || hand !== this.grabHand) return;

    this.grabbing = false;
    this.el.emit('pinchmoverend', { hand }, false);
    this.grabHand = null;
  }
});