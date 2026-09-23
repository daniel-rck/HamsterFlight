var loadedVal = Math.floor(_root.getBytesLoaded() / _root.getBytesTotal() * 100);
if(loadedVal > 1)
{
   counter_txt.text = loadedVal + "%";
}
if(loadedVal >= 100)
{
   gotoAndStop(5);
}
