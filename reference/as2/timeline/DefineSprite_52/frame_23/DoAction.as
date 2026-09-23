var sndJump = new Sound();
sndJump.attachSound("snd_jump");
sndJump.start();
sndJump.onSoundComplete = function()
{
   delete sndJump;
};
