if(_root.hamsterShoot.wind == true)
{
   this.gotoAndPlay(2);
}
else
{
   this._visible = false;
   _parent.flying_mc._visible = true;
   this.gotoAndStop(1);
}
