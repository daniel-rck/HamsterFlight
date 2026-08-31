import struct, zlib, sys, collections

TAGS = {0:'End',1:'ShowFrame',2:'DefineShape',4:'PlaceObject',5:'RemoveObject',6:'DefineBits',
7:'DefineButton',8:'JPEGTables',9:'SetBackgroundColor',10:'DefineFont',11:'DefineText',
12:'DoAction',13:'DefineFontInfo',14:'DefineSound',15:'StartSound',17:'DefineButtonSound',
18:'SoundStreamHead',19:'SoundStreamBlock',20:'DefineBitsLossless',21:'DefineBitsJPEG2',
22:'DefineShape2',23:'DefineButtonCxform',24:'Protect',26:'PlaceObject2',28:'RemoveObject2',
32:'DefineShape3',33:'DefineText2',34:'DefineButton2',35:'DefineBitsJPEG3',36:'DefineBitsLossless2',
37:'DefineEditText',39:'DefineSprite',41:'ProductInfo',43:'FrameLabel',45:'SoundStreamHead2',
46:'DefineMorphShape',48:'DefineFont2',56:'ExportAssets',57:'ImportAssets',58:'EnableDebugger',
59:'DoInitAction',60:'DefineVideoStream',61:'VideoFrame',62:'DefineFontInfo2',64:'EnableDebugger2',
65:'ScriptLimits',66:'SetTabIndex',69:'FileAttributes',70:'PlaceObject3',71:'ImportAssets2',
73:'DefineFontAlignZones',74:'CSMTextSettings',75:'DefineFont3',76:'SymbolClass',77:'Metadata',
78:'DefineScalingGrid',82:'DoABC',83:'DefineShape4',84:'DefineMorphShape2',86:'DefineSceneAndFrameLabelData',
87:'DefineBinaryData',88:'DefineFontName',89:'StartSound2',90:'DefineBitsJPEG4',91:'DefineFont4'}

def load(path):
    raw = open(path,'rb').read()
    sig = raw[:3].decode('latin1')
    ver = raw[3]
    flen = struct.unpack('<I', raw[4:8])[0]
    if sig == 'CWS':
        body = zlib.decompress(raw[8:])
    elif sig == 'ZWS':
        import lzma
        body = lzma.decompress(raw[12:])
    else:
        body = raw[8:]
    return sig, ver, flen, body

class R:
    def __init__(s,d): s.d=d; s.p=0; s.bp=0
    def u8(s):
        v=s.d[s.p]; s.p+=1; return v
    def u16(s):
        v=struct.unpack_from('<H',s.d,s.p)[0]; s.p+=2; return v
    def s16(s):
        v=struct.unpack_from('<h',s.d,s.p)[0]; s.p+=2; return v
    def u32(s):
        v=struct.unpack_from('<I',s.d,s.p)[0]; s.p+=4; return v
    def bits(s,n):
        v=0
        for _ in range(n):
            byte=s.d[s.p]
            bit=(byte>>(7-s.bp))&1
            v=(v<<1)|bit
            s.bp+=1
            if s.bp==8: s.bp=0; s.p+=1
        return v
    def align(s):
        if s.bp: s.bp=0; s.p+=1
    def rect(s):
        s.align(); n=s.bits(5)
        r=[s.bits(n) for _ in range(4)]
        s.align(); return r

def tags(body, start):
    r=R(body); r.p=start
    out=[]
    while r.p < len(body):
        code_len = r.u16()
        code = code_len>>6
        length = code_len & 0x3f
        if length == 0x3f: length = r.u32()
        data = body[r.p:r.p+length]
        out.append((code, TAGS.get(code,'?%d'%code), r.p, data))
        r.p += length
        if code == 0: break
    return out

if __name__=='__main__':
    sig,ver,flen,body = load(sys.argv[1])
    r=R(body); rect=r.rect()
    fps = r.u16()/256.0
    frames = r.u16()
    print(f'sig={sig} version={ver} declared_len={flen} body_len={len(body)}')
    print(f'stage = {rect[1]/20:.0f} x {rect[3]/20:.0f} px, fps={fps}, frames={frames}')
    tl = tags(body, r.p)
    c = collections.Counter(t[1] for t in tl)
    print('top-level tags:', len(tl))
    for k,v in c.most_common(): print(f'  {v:5d}  {k}')

def parse_matrix(r):
    r.align()
    hasScale = r.bits(1)
    sx=sy=1.0
    if hasScale:
        n=r.bits(5); sx=r.bits(n)/65536.0; sy=r.bits(n)/65536.0
    hasRot = r.bits(1)
    if hasRot:
        n=r.bits(5); r.bits(n); r.bits(n)
    n=r.bits(5); tx=r.bits(n); ty=r.bits(n)
    r.align()
    return sx,sy,tx/20.0,ty/20.0

def po2(data):
    r=R(data)
    f=r.u8(); depth=r.u16()
    cid=None; mat=None; name=None
    if f&2: cid=r.u16()
    if f&4: mat=parse_matrix(r)
    if f&8:  # cxform
        return depth,cid,mat,None
    if f&16: r.u16()
    if f&32:
        b=bytearray()
        while True:
            c=r.u8()
            if c==0: break
            b.append(c)
        name=b.decode('latin1')
    return depth,cid,mat,name

def sprite_tags(data):
    r=R(data); sid=r.u16(); fc=r.u16()
    return sid, fc, tags(data, r.p)

def walk(path):
    sig,ver,flen,body=load(path)
    r=R(body); r.rect(); r.u16(); r.u16()
    tl=tags(body,r.p)
    named=[]
    def scan(tlist, ctx):
        for code,nm,off,data in tlist:
            if code==26:
                try:
                    depth,cid,mat,name=po2(data)
                except Exception: continue
                if name: named.append((ctx,name,cid,mat))
            elif code==39:
                try: sid,fc,st=sprite_tags(data)
                except Exception: continue
                scan(st, f'{ctx}/Sprite{sid}')
    scan(tl,'root')
    return named

if len(sys.argv)>2 and sys.argv[2]=='names':
    for ctx,name,cid,mat in walk(sys.argv[1]):
        pos = f'x={mat[2]:.1f} y={mat[3]:.1f}' if mat else 'no-matrix'
        print(f'{name:24s} char={cid} {pos}  [{ctx}]')
