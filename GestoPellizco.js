// Versión adaptada: usa el system si existe; si no, fallback (mínimo) con warning.
AFRAME.registerComponent('gesto-pellizco', {
  schema:{
    hand:{type:'string', default:'any'},
    emitEachFrame:{type:'boolean', default:false}
  },
  init:function(){
    this.systemRef = this.el.sceneEl.systems['hand-gestures-system'];
    if (!this.systemRef) {
      console.warn('[gesto-pellizco] Falta hand-gestures-system. Añádelo para unificar lógica.');
    }
    this._onStart = e => {
      if (this._matchHand(e.detail.hand)) this.el.emit('pinchstart', e.detail, false);
    };
    this._onEnd = e => {
      if (this._matchHand(e.detail.hand)) this.el.emit('pinchend', e.detail, false);
    };
    this._onMove = e => {
      if (this.data.emitEachFrame && this._matchHand(e.detail.hand))
        this.el.emit('pinchmove', e.detail, false);
    };
    this._bindSceneEvents(true);
  },
  remove:function(){
    this._bindSceneEvents(false);
  },
  _bindSceneEvents:function(add){
    const s = this.el.sceneEl;
    if (!s) return;
    const m = add ? 'addEventListener' : 'removeEventListener';
    s[m]('hg-pinchstart', this._onStart);
    s[m]('hg-pinchend', this._onEnd);
    s[m]('hg-pinchmove', this._onMove);
  },
  _matchHand:function(hand){
    return this.data.hand === 'any' || this.data.hand === hand;
  }
});