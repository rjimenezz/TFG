AFRAME.registerComponent('pinch-move', {
  schema: {
    hand: { type: 'string', default: 'any' },     // 'left' | 'right' | 'any'
    radius: { type: 'number', default: 0.15 },    // radio de selección (m)
    rotateMode: { type: 'string', default: 'yaw' }, // 'none' | 'yaw' | 'full'
    debug: { type: 'boolean', default: false }
  },

  init: function () {
    this.sceneEl = this.el.sceneEl;
    this.renderer = (this.sceneEl && this.sceneEl.renderer) || null;
    this.referenceSpace = null;

    this.grabbing = false;
    this.grabHand = null;

    // Posición
    this.grabOffset = new THREE.Vector3(); // offset (mundo) entre objeto y pellizco al iniciar
    this.tmpWorldPos = new THREE.Vector3();
    this.tmpTarget   = new THREE.Vector3();

    // Rotación
    this.startDir = new THREE.Vector3();  // índice - pulgar (mundo)
    this.currDir  = new THREE.Vector3();
    this.startYaw = 0;

    this.startWorldQuat = new THREE.Quaternion();
    this.parentWorldQuat = new THREE.Quaternion();
    this.parentWorldQuatInv = new THREE.Quaternion();
    this.qDelta = new THREE.Quaternion();
    this.qYaw   = new THREE.Quaternion();
    this.newWorldQuat = new THREE.Quaternion();
    this.newLocalQuat = new THREE.Quaternion();

    // Cuats de mano para rotación total
    this.startHandQuat = new THREE.Quaternion();
    this.startHandQuatInv = new THREE.Quaternion();
    this.currHandQuat = new THREE.Quaternion();

    if (this.data.debug) {
      this._debugSphere = document.createElement('a-sphere');
      this._debugSphere.setAttribute('radius', this.data.radius);
      this._debugSphere.setAttribute('color', '#8844ff');
      this._debugSphere.setAttribute('opacity', 0.15);
      this._debugSphere.setAttribute('segments-width', 12);
      this._debugSphere.setAttribute('segments-height', 8);
      this.el.appendChild(this._debugSphere);
    }

    this.detector = document.getElementById('detector');
    if (!this.detector) {
      console.warn('[pinch-move] Falta #detector con gesto-pellizco.');
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

  // Juntas y frame
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

      const hand = inputSource.hand;
      const jp = n => hand.get(n) && frame.getJointPose(hand.get(n), this.referenceSpace);

      const thumbPose = jp('thumb-tip');
      const indexPose = jp('index-finger-tip');
      if (!thumbPose || !indexPose) continue;

      const wristPose = jp('wrist');
      const idxMcpPose = jp('index-finger-metacarpal');
      const pkyMcpPose = jp('pinky-finger-metacarpal');

      const v = (p)=> new THREE.Vector3(p.transform.position.x, p.transform.position.y, p.transform.position.z);

      const thumb = v(thumbPose);
      const index = v(indexPose);
      const mid   = new THREE.Vector3().addVectors(thumb, index).multiplyScalar(0.5);
      const dir   = new THREE.Vector3().subVectors(index, thumb).normalize();

      const wrist = wristPose ? v(wristPose) : null;
      const idxM  = idxMcpPose ? v(idxMcpPose) : null;
      const pkyM  = pkyMcpPose ? v(pkyMcpPose) : null;

      return { mid, thumb, index, dir, wrist, idxM, pkyM };
    }
    return null;
  },

  // Construye una orientación de mano (cuaternion) a partir del eje pinza y plano de la palma
  _computeHandQuat: function (data, outQuat) {
    // x = eje pinza (índice - pulgar)
    const x = data.dir.clone().normalize();

    // normal de la palma ~ cross(indexMCP - wrist, pinkyMCP - wrist)
    let y;
    if (data.wrist && data.idxM && data.pkyM) {
      const a = new THREE.Vector3().subVectors(data.idxM, data.wrist).normalize();
      const b = new THREE.Vector3().subVectors(data.pkyM, data.wrist).normalize();
      y = new THREE.Vector3().crossVectors(a, b).normalize(); // normal de la palma
    } else {
      y = new THREE.Vector3(0, 1, 0);
    }

    // z = x × y (re-ortogonalizar), y = z × x
    let z = new THREE.Vector3().crossVectors(x, y);
    if (z.lengthSq() < 1e-6) {
      // fallback si y casi paralelo a x
      y.set(0, 1, 0);
      z.crossVectors(x, y);
      if (z.lengthSq() < 1e-6) y.set(0, 0, 1), z.crossVectors(x, y);
    }
    z.normalize();
    y.crossVectors(z, x).normalize();

    // Matriz con ejes como columnas
    const m = new THREE.Matrix4().set(
      x.x, y.x, z.x, 0,
      x.y, y.y, z.y, 0,
      x.z, y.z, z.z, 0,
      0,   0,   0,   1
    );
    outQuat.setFromRotationMatrix(m);
    return outQuat;
  },

  _onPinchStart: function (e) {
    const hand = e.detail && e.detail.hand;
    if (!hand || !this._matchHand(hand)) return;

    const data = this._getPinchData(hand);
    if (!data) return;

    // Selección por proximidad
    this.el.object3D.getWorldPosition(this.tmpWorldPos);
    const dist = this.tmpWorldPos.distanceTo(data.mid);
    if (dist > this.data.radius) return;

    this.grabbing = true;
    this.grabHand = hand;

    // Offset de agarre (mundo)
    this.grabOffset.copy(this.tmpWorldPos).sub(data.mid);

    // Estado inicial de rotación
    this.startDir.copy(data.dir);
    this.startYaw = Math.atan2(this.startDir.x, this.startDir.z);

    this.el.object3D.getWorldQuaternion(this.startWorldQuat);
    const parent = this.el.object3D.parent;
    if (parent) parent.getWorldQuaternion(this.parentWorldQuat);
    else this.parentWorldQuat.identity();
    this.parentWorldQuatInv.copy(this.parentWorldQuat).invert();

    // Cuaternion de mano inicial (para rotación 3D completa)
    this._computeHandQuat(data, this.startHandQuat);
    this.startHandQuatInv.copy(this.startHandQuat).invert();

    this.el.emit('pinchmoverstart', { hand, distance: dist }, false);
  },

  _onPinchMove: function (e) {
    if (!this.grabbing) return;
    const hand = e.detail && e.detail.hand;
    if (hand !== this.grabHand) return;

    const data = this._getPinchData(hand);
    if (!data) return;

    // Delta de rotación en mundo según modo
    let qDeltaWorld;
    if (this.data.rotateMode === 'full') {
      this._computeHandQuat(data, this.currHandQuat);
      // qDeltaWorld = curr * inv(start)
      this.qDelta.multiplyQuaternions(this.currHandQuat, this.startHandQuatInv);
      qDeltaWorld = this.qDelta;
    } else if (this.data.rotateMode === 'yaw') {
      this.currDir.copy(data.dir);
      const currYaw = Math.atan2(this.currDir.x, this.currDir.z);
      const deltaYaw = currYaw - this.startYaw;
      this.qYaw.setFromAxisAngle(new THREE.Vector3(0, 1, 0), deltaYaw);
      qDeltaWorld = this.qYaw;
    } else {
      qDeltaWorld = new THREE.Quaternion(); // identidad
    }

    // Posición objetivo (mundo): rotar offset igual que el objeto
    const rotatedOffset = this.grabOffset.clone().applyQuaternion(qDeltaWorld);
    this.tmpTarget.copy(data.mid).add(rotatedOffset);

    // Pasar a local del padre
    const parent = this.el.object3D.parent;
    if (parent) parent.worldToLocal(this.tmpTarget);
    this.el.object3D.position.copy(this.tmpTarget);

    // Orientación local: newWorld = qDeltaWorld * startWorld
    this.newWorldQuat.multiplyQuaternions(qDeltaWorld, this.startWorldQuat);
    this.newLocalQuat.multiplyQuaternions(this.parentWorldQuatInv, this.newWorldQuat);
    if (this.data.rotateMode !== 'none') {
      this.el.object3D.quaternion.copy(this.newLocalQuat);
    }

    this.el.emit('pinchmovermove', { hand, position: this.tmpTarget.clone() }, false);
  },

  _onPinchEnd: function (e) {
    const hand = e.detail && e.detail.hand;
    if (!this.grabbing || hand !== this.grabHand) return;
    this.grabbing = false;
    this.el.emit('pinchmoverend', { hand }, false);
    this.grabHand = null;
  }
});