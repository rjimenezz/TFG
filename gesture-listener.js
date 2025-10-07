// Escucha pinch y dispara eventos locales si el pinch ocurre dentro de un radio.
AFRAME.registerComponent('pinch-interactable', {
  schema:{
    hand:{type:'string', default:'any'},
    radius:{type:'number', default:0.08}, // metros
    requireActivePinch:{type:'boolean', default:true},
    debug:{type:'boolean', default:false}
  },
  init:function(){
    this.systemRef = this.el.sceneEl.systems['hand-gestures-system'];
    if (!this.systemRef) console.warn('[pinch-interactable] Requiere hand-gestures-system');
    this.center = new THREE.Vector3();
    if (this.data.debug){
      this._dbg = document.createElement('a-sphere');
      this._dbg.setAttribute('radius', this.data.radius);
      this._dbg.setAttribute('color', '#8844ff');
      this._dbg.setAttribute('opacity', 0.15);
      this.el.appendChild(this._dbg);
    }
    this._onPinchStart = e => this._check(e, 'pinchselectstart');
    this._onPinchEnd   = e => this._check(e, 'pinchselectend');
    this._onPinchMove  = e => this._check(e, 'pinchselectmove');
    const sc = this.el.sceneEl;
    sc.addEventListener('hg-pinchstart', this._onPinchStart);
    sc.addEventListener('hg-pinchend', this._onPinchEnd);
    sc.addEventListener('hg-pinchmove', this._onPinchMove);
  },
  remove:function(){
    const sc = this.el.sceneEl;
    if (!sc) return;
    sc.removeEventListener('hg-pinchstart', this._onPinchStart);
    sc.removeEventListener('hg-pinchend', this._onPinchEnd);
    sc.removeEventListener('hg-pinchmove', this._onPinchMove);
    if (this._dbg) this._dbg.remove();
  },
  _check:function(evt, localEvent){
    if (!this._matchHand(evt.detail.hand)) return;
    if (!this.systemRef) return;
    const handData = this.systemRef.getHand(evt.detail.hand);
    if (!handData) return;
    // Usamos muñeca como referencia simple (podrías usar index-finger-tip)
    const wrist = handData.joints.get('wrist');
    if (!wrist) return;
    this.el.object3D.getWorldPosition(this.center);
    const p = wrist.transform.position;
    const dist = this.center.distanceTo(new THREE.Vector3(p.x, p.y, p.z));
    if (dist <= this.data.radius) {
      this.el.emit(localEvent, {
        hand: evt.detail.hand,
        distance: evt.detail.distance,
        wristDistance: dist
      }, false);
    }
  },
  _matchHand:function(hand){
    return this.data.hand === 'any' || this.data.hand === hand;
  }
});