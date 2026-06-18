import sys, os, glob
from PIL import Image, ImageDraw, ImageFont
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "out")

def load_font(sz):
    for p in ["/System/Library/Fonts/SFNS.ttf","/System/Library/Fonts/Helvetica.ttc",
              "/Library/Fonts/Arial.ttf"]:
        try: return ImageFont.truetype(p,sz)
        except: pass
    return ImageFont.load_default()

def strip(sub, labels, thumb_w=300):
    files=sorted(glob.glob(f"{OUT}/{sub}/f*.png"))
    ims=[Image.open(f).convert("RGB") for f in files]
    w,h=ims[0].size; r=thumb_w/w; tw,th=thumb_w,int(h*r)
    pad,top,gap=10,40,10
    W=pad+ (tw+gap)*len(ims) - gap + pad
    H=top+th+pad
    canv=Image.new("RGB",(W,H),(243,241,236))
    d=ImageDraw.Draw(canv); f=load_font(20); fs=load_font(15)
    d.text((pad,10), labels[0], fill=(60,56,50), font=f)
    x=pad
    for i,im in enumerate(ims):
        canv.paste(im.resize((tw,th)),(x,top))
        d.rectangle([x,top,x+tw-1,top+th-1],outline=(214,201,178),width=2)
        if i+1<len(labels):
            d.rectangle([x,top,x+150,top+22],fill=(194,125,139))
            d.text((x+6,top+3), labels[i+1], fill=(255,255,255), font=fs)
        x+=tw+gap
    return canv

walk=strip("walk",["WALK  — little hops in to the path",
    "enter","hop","hop","hop","arrive"])
joy=strip("joy",["JUMP FOR JOY  — anticipate · launch · apex · fall · squash · rebound",
    "crouch","launch","apex ✦","fall","squash","rebound"])

W=max(walk.width,joy.width); g=16
sheet=Image.new("RGB",(W,walk.height+joy.height+g),(243,241,236))
sheet.paste(walk,(0,0)); sheet.paste(joy,(0,walk.height+g))
sheet.save(f"{OUT}/paper-contact.png")
sheet.save(f"{OUT}/paper-contact.jpg",quality=86)
print("size",sheet.size)
