CC = wcc386
RC = wrc
CFLAGS = -q -s -ecd -wx
# Instant VM changes: -bt=nt selects Win32 (PE) resource output; on POSIX
# hosts wrc otherwise emits a Win16/OS/2 .res that wlink rejects.
RCFLAGS = -q -r -zm -bt=nt
INCS = -I"$(%WATCOM)/h/nt/ddk"
LIBS = $(%WATCOM)/lib386/nt/ddk

# Debug flag - note that the video port in Windows NT 3.x only exports
# VideoDebugPort in checked builds!
#CFLAGS += -DDBG

CFLAGS += -d1 -hc

OBJS = videomp.obj vidmpdat.obj boxv.obj vmplog.obj

# Instant VM changes: -fo=$@ - on POSIX hosts wcc386 names objects *.o by
# default and the .obj rule below would never find its target.
.c.obj : .autodepend
    $(CC) $(CFLAGS) $(INCS) -fo=$@ $<

# Instant VM changes: link via the boxvideo.lnk response file (see the
# comment there for why the command-line form fails on POSIX hosts).
boxvideo.sys : $(OBJS) $(__MAKEFILES__) videomp.res boxvideo.lnk
    wlink @boxvideo.lnk

# Normally we would like to use the following:
#      option alignment=0x20, objalign=0x20
# but that causes the driver image to fail loading on old NT releases;
# the driver is small enough that it's not worth the trouble

videomp.res : videomp.rc
    $(RC) $(RCFLAGS) $(INCS) $<

# Create a 1.44MB distribution floppy image.
# NB: The mkimage tool is not supplied.
videomp.img : boxvideo.sys disk1 readme.txt oemsetup.inf vidmini.inf
    if not exist dist mkdir dist
    cp disk1        dist
    cp boxvideo.sys dist
    cp boxvideo.sym dist
    cp oemsetup.inf dist
    cp vidmini.inf  dist
    cp readme.txt   dist
    mkimage -l VIDEOMP -o videomp.img dist
    
clean : .symbolic
    rm -f *.obj
    rm -f *.o
    rm -f *.err
    rm -f *.sys
    rm -f *.sym
    rm -f *.res
    rm -f *.map
    rm -f videomp.img
    rm -f dist/disk1
    rm -f dist/boxvideo.sys
    rm -f dist/boxvideo.sym
    rm -f dist/oemsetup.inf
    rm -f dist/vidmini.inf
    rm -f dist/readme.txt
    if exist dist rmdir dist
