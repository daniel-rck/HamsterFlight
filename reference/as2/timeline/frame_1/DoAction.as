var LOCAL = false;
var domXML = new XML();
if(§§pop() != LOCAL)
{
   gotoAndPlay(2);
}
else
{
   domXML.load("http://www.cartoonnetwork.com/crossdomain.xml");
}
domXML.onLoad = function()
{
   if(domXML.childNodes.length == 0)
   {
      getURL("http://www.cartoonnetwork.com");
      stop();
   }
   else
   {
      gotoAndPlay(2);
   }
};
