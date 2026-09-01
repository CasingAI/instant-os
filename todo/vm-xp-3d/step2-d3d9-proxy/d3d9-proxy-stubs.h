/* 由 gen-stubs.mjs 从 zig 自带 d3d9.h 生成——不要手改，重跑生成器。
 * IDirect3DDevice9 全量虚表 stub：每个槽位都有签名正确的函数，
 * 未实现的方法记录一次日志后返回 D3D_OK。真实现见 d3d9-proxy.c。 */
#pragma once

/* 真实现（d3d9-proxy.c）提供：同名去 stub 前缀的 10 个方法 + 本回调。 */
static void proxy_stub_hit(const char *name);

static UINT STDMETHODCALLTYPE dev_GetAvailableTextureMem( struct IDirect3DDevice9 *This )
{
    (void)This;
    proxy_stub_hit("GetAvailableTextureMem");
    return (UINT)0;
}

static HRESULT STDMETHODCALLTYPE dev_EvictManagedResources( struct IDirect3DDevice9 *This )
{
    (void)This;
    proxy_stub_hit("EvictManagedResources");
    return (HRESULT)0;
}

static HRESULT STDMETHODCALLTYPE dev_GetDeviceCaps( struct IDirect3DDevice9 *This, D3DCAPS9* pCaps )
{
    (void)This;
    proxy_stub_hit("GetDeviceCaps");
    return (HRESULT)0;
}

static HRESULT STDMETHODCALLTYPE dev_GetDisplayMode( struct IDirect3DDevice9 *This, UINT iSwapChain, D3DDISPLAYMODE* pMode )
{
    (void)This;
    proxy_stub_hit("GetDisplayMode");
    return (HRESULT)0;
}

static HRESULT STDMETHODCALLTYPE dev_GetCreationParameters( struct IDirect3DDevice9 *This, D3DDEVICE_CREATION_PARAMETERS *pParameters )
{
    (void)This;
    proxy_stub_hit("GetCreationParameters");
    return (HRESULT)0;
}

static HRESULT STDMETHODCALLTYPE dev_SetCursorProperties( struct IDirect3DDevice9 *This, UINT XHotSpot, UINT YHotSpot, IDirect3DSurface9* pCursorBitmap )
{
    (void)This;
    proxy_stub_hit("SetCursorProperties");
    return (HRESULT)0;
}

static void STDMETHODCALLTYPE dev_SetCursorPosition( struct IDirect3DDevice9 *This, int X,int Y, DWORD Flags )
{
    (void)This;
    proxy_stub_hit("SetCursorPosition");
}

static WINBOOL STDMETHODCALLTYPE dev_ShowCursor( struct IDirect3DDevice9 *This, WINBOOL bShow )
{
    (void)This;
    proxy_stub_hit("ShowCursor");
    return (WINBOOL)0;
}

static HRESULT STDMETHODCALLTYPE dev_CreateAdditionalSwapChain( struct IDirect3DDevice9 *This, D3DPRESENT_PARAMETERS* pPresentationParameters, IDirect3DSwapChain9** pSwapChain )
{
    (void)This;
    proxy_stub_hit("CreateAdditionalSwapChain");
    return (HRESULT)0;
}

static HRESULT STDMETHODCALLTYPE dev_GetSwapChain( struct IDirect3DDevice9 *This, UINT iSwapChain, IDirect3DSwapChain9** pSwapChain )
{
    (void)This;
    proxy_stub_hit("GetSwapChain");
    return (HRESULT)0;
}

static UINT STDMETHODCALLTYPE dev_GetNumberOfSwapChains( struct IDirect3DDevice9 *This )
{
    (void)This;
    proxy_stub_hit("GetNumberOfSwapChains");
    return (UINT)0;
}

static HRESULT STDMETHODCALLTYPE dev_GetBackBuffer( struct IDirect3DDevice9 *This, UINT iSwapChain, UINT iBackBuffer, D3DBACKBUFFER_TYPE Type, IDirect3DSurface9** ppBackBuffer )
{
    (void)This;
    proxy_stub_hit("GetBackBuffer");
    return (HRESULT)0;
}

static HRESULT STDMETHODCALLTYPE dev_GetRasterStatus( struct IDirect3DDevice9 *This, UINT iSwapChain, D3DRASTER_STATUS* pRasterStatus )
{
    (void)This;
    proxy_stub_hit("GetRasterStatus");
    return (HRESULT)0;
}

static HRESULT STDMETHODCALLTYPE dev_SetDialogBoxMode( struct IDirect3DDevice9 *This, WINBOOL bEnableDialogs )
{
    (void)This;
    proxy_stub_hit("SetDialogBoxMode");
    return (HRESULT)0;
}

static void STDMETHODCALLTYPE dev_SetGammaRamp( struct IDirect3DDevice9 *This, UINT swapchain_idx, DWORD flags, const D3DGAMMARAMP *ramp )
{
    (void)This;
    proxy_stub_hit("SetGammaRamp");
}

static void STDMETHODCALLTYPE dev_GetGammaRamp( struct IDirect3DDevice9 *This, UINT iSwapChain, D3DGAMMARAMP* pRamp )
{
    (void)This;
    proxy_stub_hit("GetGammaRamp");
}

static HRESULT STDMETHODCALLTYPE dev_CreateTexture( struct IDirect3DDevice9 *This, UINT Width, UINT Height, UINT Levels, DWORD Usage, D3DFORMAT Format, D3DPOOL Pool, IDirect3DTexture9** ppTexture, HANDLE* pSharedHandle )
{
    (void)This;
    proxy_stub_hit("CreateTexture");
    return (HRESULT)0;
}

static HRESULT STDMETHODCALLTYPE dev_CreateVolumeTexture( struct IDirect3DDevice9 *This, UINT Width, UINT Height, UINT Depth, UINT Levels, DWORD Usage, D3DFORMAT Format, D3DPOOL Pool, IDirect3DVolumeTexture9** ppVolumeTexture, HANDLE* pSharedHandle )
{
    (void)This;
    proxy_stub_hit("CreateVolumeTexture");
    return (HRESULT)0;
}

static HRESULT STDMETHODCALLTYPE dev_CreateCubeTexture( struct IDirect3DDevice9 *This, UINT EdgeLength, UINT Levels, DWORD Usage, D3DFORMAT Format, D3DPOOL Pool, IDirect3DCubeTexture9** ppCubeTexture, HANDLE* pSharedHandle )
{
    (void)This;
    proxy_stub_hit("CreateCubeTexture");
    return (HRESULT)0;
}

static HRESULT STDMETHODCALLTYPE dev_CreateVertexBuffer( struct IDirect3DDevice9 *This, UINT Length, DWORD Usage, DWORD FVF, D3DPOOL Pool, IDirect3DVertexBuffer9** ppVertexBuffer, HANDLE* pSharedHandle )
{
    (void)This;
    proxy_stub_hit("CreateVertexBuffer");
    return (HRESULT)0;
}

static HRESULT STDMETHODCALLTYPE dev_CreateIndexBuffer( struct IDirect3DDevice9 *This, UINT Length, DWORD Usage, D3DFORMAT Format, D3DPOOL Pool, IDirect3DIndexBuffer9** ppIndexBuffer, HANDLE* pSharedHandle )
{
    (void)This;
    proxy_stub_hit("CreateIndexBuffer");
    return (HRESULT)0;
}

static HRESULT STDMETHODCALLTYPE dev_CreateRenderTarget( struct IDirect3DDevice9 *This, UINT Width, UINT Height, D3DFORMAT Format, D3DMULTISAMPLE_TYPE MultiSample, DWORD MultisampleQuality, WINBOOL Lockable, IDirect3DSurface9** ppSurface, HANDLE* pSharedHandle )
{
    (void)This;
    proxy_stub_hit("CreateRenderTarget");
    return (HRESULT)0;
}

static HRESULT STDMETHODCALLTYPE dev_CreateDepthStencilSurface( struct IDirect3DDevice9 *This, UINT Width, UINT Height, D3DFORMAT Format, D3DMULTISAMPLE_TYPE MultiSample, DWORD MultisampleQuality, WINBOOL Discard, IDirect3DSurface9** ppSurface, HANDLE* pSharedHandle )
{
    (void)This;
    proxy_stub_hit("CreateDepthStencilSurface");
    return (HRESULT)0;
}

static HRESULT STDMETHODCALLTYPE dev_UpdateSurface( struct IDirect3DDevice9 *This, IDirect3DSurface9 *src_surface, const RECT *src_rect,
            IDirect3DSurface9 *dst_surface, const POINT *dst_point )
{
    (void)This;
    proxy_stub_hit("UpdateSurface");
    return (HRESULT)0;
}

static HRESULT STDMETHODCALLTYPE dev_UpdateTexture( struct IDirect3DDevice9 *This, IDirect3DBaseTexture9* pSourceTexture, IDirect3DBaseTexture9* pDestinationTexture )
{
    (void)This;
    proxy_stub_hit("UpdateTexture");
    return (HRESULT)0;
}

static HRESULT STDMETHODCALLTYPE dev_GetRenderTargetData( struct IDirect3DDevice9 *This, IDirect3DSurface9* pRenderTarget, IDirect3DSurface9* pDestSurface )
{
    (void)This;
    proxy_stub_hit("GetRenderTargetData");
    return (HRESULT)0;
}

static HRESULT STDMETHODCALLTYPE dev_GetFrontBufferData( struct IDirect3DDevice9 *This, UINT iSwapChain, IDirect3DSurface9* pDestSurface )
{
    (void)This;
    proxy_stub_hit("GetFrontBufferData");
    return (HRESULT)0;
}

static HRESULT STDMETHODCALLTYPE dev_StretchRect( struct IDirect3DDevice9 *This, IDirect3DSurface9 *src_surface, const RECT *src_rect,
            IDirect3DSurface9 *dst_surface, const RECT *dst_rect, D3DTEXTUREFILTERTYPE filter )
{
    (void)This;
    proxy_stub_hit("StretchRect");
    return (HRESULT)0;
}

static HRESULT STDMETHODCALLTYPE dev_ColorFill( struct IDirect3DDevice9 *This, IDirect3DSurface9 *surface, const RECT *rect, D3DCOLOR color )
{
    (void)This;
    proxy_stub_hit("ColorFill");
    return (HRESULT)0;
}

static HRESULT STDMETHODCALLTYPE dev_CreateOffscreenPlainSurface( struct IDirect3DDevice9 *This, UINT Width, UINT Height, D3DFORMAT Format, D3DPOOL Pool, IDirect3DSurface9** ppSurface, HANDLE* pSharedHandle )
{
    (void)This;
    proxy_stub_hit("CreateOffscreenPlainSurface");
    return (HRESULT)0;
}

static HRESULT STDMETHODCALLTYPE dev_SetRenderTarget( struct IDirect3DDevice9 *This, DWORD RenderTargetIndex, IDirect3DSurface9* pRenderTarget )
{
    (void)This;
    proxy_stub_hit("SetRenderTarget");
    return (HRESULT)0;
}

static HRESULT STDMETHODCALLTYPE dev_GetRenderTarget( struct IDirect3DDevice9 *This, DWORD RenderTargetIndex, IDirect3DSurface9** ppRenderTarget )
{
    (void)This;
    proxy_stub_hit("GetRenderTarget");
    return (HRESULT)0;
}

static HRESULT STDMETHODCALLTYPE dev_SetDepthStencilSurface( struct IDirect3DDevice9 *This, IDirect3DSurface9* pNewZStencil )
{
    (void)This;
    proxy_stub_hit("SetDepthStencilSurface");
    return (HRESULT)0;
}

static HRESULT STDMETHODCALLTYPE dev_GetDepthStencilSurface( struct IDirect3DDevice9 *This, IDirect3DSurface9** ppZStencilSurface )
{
    (void)This;
    proxy_stub_hit("GetDepthStencilSurface");
    return (HRESULT)0;
}

static HRESULT STDMETHODCALLTYPE dev_SetTransform( struct IDirect3DDevice9 *This, D3DTRANSFORMSTATETYPE state, const D3DMATRIX *matrix )
{
    (void)This;
    proxy_stub_hit("SetTransform");
    return (HRESULT)0;
}

static HRESULT STDMETHODCALLTYPE dev_GetTransform( struct IDirect3DDevice9 *This, D3DTRANSFORMSTATETYPE State, D3DMATRIX* pMatrix )
{
    (void)This;
    proxy_stub_hit("GetTransform");
    return (HRESULT)0;
}

static HRESULT STDMETHODCALLTYPE dev_MultiplyTransform( struct IDirect3DDevice9 *This, D3DTRANSFORMSTATETYPE state, const D3DMATRIX *matrix )
{
    (void)This;
    proxy_stub_hit("MultiplyTransform");
    return (HRESULT)0;
}

static HRESULT STDMETHODCALLTYPE dev_SetViewport( struct IDirect3DDevice9 *This, const D3DVIEWPORT9 *viewport )
{
    (void)This;
    proxy_stub_hit("SetViewport");
    return (HRESULT)0;
}

static HRESULT STDMETHODCALLTYPE dev_GetViewport( struct IDirect3DDevice9 *This, D3DVIEWPORT9* pViewport )
{
    (void)This;
    proxy_stub_hit("GetViewport");
    return (HRESULT)0;
}

static HRESULT STDMETHODCALLTYPE dev_SetMaterial( struct IDirect3DDevice9 *This, const D3DMATERIAL9 *material )
{
    (void)This;
    proxy_stub_hit("SetMaterial");
    return (HRESULT)0;
}

static HRESULT STDMETHODCALLTYPE dev_GetMaterial( struct IDirect3DDevice9 *This, D3DMATERIAL9* pMaterial )
{
    (void)This;
    proxy_stub_hit("GetMaterial");
    return (HRESULT)0;
}

static HRESULT STDMETHODCALLTYPE dev_SetLight( struct IDirect3DDevice9 *This, DWORD index, const D3DLIGHT9 *light )
{
    (void)This;
    proxy_stub_hit("SetLight");
    return (HRESULT)0;
}

static HRESULT STDMETHODCALLTYPE dev_GetLight( struct IDirect3DDevice9 *This, DWORD Index, D3DLIGHT9* )
{
    (void)This;
    proxy_stub_hit("GetLight");
    return (HRESULT)0;
}

static HRESULT STDMETHODCALLTYPE dev_LightEnable( struct IDirect3DDevice9 *This, DWORD Index, WINBOOL Enable )
{
    (void)This;
    proxy_stub_hit("LightEnable");
    return (HRESULT)0;
}

static HRESULT STDMETHODCALLTYPE dev_GetLightEnable( struct IDirect3DDevice9 *This, DWORD Index, WINBOOL* pEnable )
{
    (void)This;
    proxy_stub_hit("GetLightEnable");
    return (HRESULT)0;
}

static HRESULT STDMETHODCALLTYPE dev_SetClipPlane( struct IDirect3DDevice9 *This, DWORD index, const float *plane )
{
    (void)This;
    proxy_stub_hit("SetClipPlane");
    return (HRESULT)0;
}

static HRESULT STDMETHODCALLTYPE dev_GetClipPlane( struct IDirect3DDevice9 *This, DWORD Index, float* pPlane )
{
    (void)This;
    proxy_stub_hit("GetClipPlane");
    return (HRESULT)0;
}

static HRESULT STDMETHODCALLTYPE dev_SetRenderState( struct IDirect3DDevice9 *This, D3DRENDERSTATETYPE State, DWORD Value )
{
    (void)This;
    proxy_stub_hit("SetRenderState");
    return (HRESULT)0;
}

static HRESULT STDMETHODCALLTYPE dev_GetRenderState( struct IDirect3DDevice9 *This, D3DRENDERSTATETYPE State, DWORD* pValue )
{
    (void)This;
    proxy_stub_hit("GetRenderState");
    return (HRESULT)0;
}

static HRESULT STDMETHODCALLTYPE dev_CreateStateBlock( struct IDirect3DDevice9 *This, D3DSTATEBLOCKTYPE Type, IDirect3DStateBlock9** ppSB )
{
    (void)This;
    proxy_stub_hit("CreateStateBlock");
    return (HRESULT)0;
}

static HRESULT STDMETHODCALLTYPE dev_BeginStateBlock( struct IDirect3DDevice9 *This )
{
    (void)This;
    proxy_stub_hit("BeginStateBlock");
    return (HRESULT)0;
}

static HRESULT STDMETHODCALLTYPE dev_EndStateBlock( struct IDirect3DDevice9 *This, IDirect3DStateBlock9** ppSB )
{
    (void)This;
    proxy_stub_hit("EndStateBlock");
    return (HRESULT)0;
}

static HRESULT STDMETHODCALLTYPE dev_SetClipStatus( struct IDirect3DDevice9 *This, const D3DCLIPSTATUS9 *clip_status )
{
    (void)This;
    proxy_stub_hit("SetClipStatus");
    return (HRESULT)0;
}

static HRESULT STDMETHODCALLTYPE dev_GetClipStatus( struct IDirect3DDevice9 *This, D3DCLIPSTATUS9* pClipStatus )
{
    (void)This;
    proxy_stub_hit("GetClipStatus");
    return (HRESULT)0;
}

static HRESULT STDMETHODCALLTYPE dev_GetTexture( struct IDirect3DDevice9 *This, DWORD Stage, IDirect3DBaseTexture9** ppTexture )
{
    (void)This;
    proxy_stub_hit("GetTexture");
    return (HRESULT)0;
}

static HRESULT STDMETHODCALLTYPE dev_SetTexture( struct IDirect3DDevice9 *This, DWORD Stage, IDirect3DBaseTexture9* pTexture )
{
    (void)This;
    proxy_stub_hit("SetTexture");
    return (HRESULT)0;
}

static HRESULT STDMETHODCALLTYPE dev_GetTextureStageState( struct IDirect3DDevice9 *This, DWORD Stage, D3DTEXTURESTAGESTATETYPE Type, DWORD* pValue )
{
    (void)This;
    proxy_stub_hit("GetTextureStageState");
    return (HRESULT)0;
}

static HRESULT STDMETHODCALLTYPE dev_SetTextureStageState( struct IDirect3DDevice9 *This, DWORD Stage, D3DTEXTURESTAGESTATETYPE Type, DWORD Value )
{
    (void)This;
    proxy_stub_hit("SetTextureStageState");
    return (HRESULT)0;
}

static HRESULT STDMETHODCALLTYPE dev_GetSamplerState( struct IDirect3DDevice9 *This, DWORD Sampler, D3DSAMPLERSTATETYPE Type, DWORD* pValue )
{
    (void)This;
    proxy_stub_hit("GetSamplerState");
    return (HRESULT)0;
}

static HRESULT STDMETHODCALLTYPE dev_SetSamplerState( struct IDirect3DDevice9 *This, DWORD Sampler, D3DSAMPLERSTATETYPE Type, DWORD Value )
{
    (void)This;
    proxy_stub_hit("SetSamplerState");
    return (HRESULT)0;
}

static HRESULT STDMETHODCALLTYPE dev_ValidateDevice( struct IDirect3DDevice9 *This, DWORD* pNumPasses )
{
    (void)This;
    proxy_stub_hit("ValidateDevice");
    return (HRESULT)0;
}

static HRESULT STDMETHODCALLTYPE dev_SetPaletteEntries( struct IDirect3DDevice9 *This, UINT palette_idx, const PALETTEENTRY *entries )
{
    (void)This;
    proxy_stub_hit("SetPaletteEntries");
    return (HRESULT)0;
}

static HRESULT STDMETHODCALLTYPE dev_GetPaletteEntries( struct IDirect3DDevice9 *This, UINT PaletteNumber,PALETTEENTRY* pEntries )
{
    (void)This;
    proxy_stub_hit("GetPaletteEntries");
    return (HRESULT)0;
}

static HRESULT STDMETHODCALLTYPE dev_SetCurrentTexturePalette( struct IDirect3DDevice9 *This, UINT PaletteNumber )
{
    (void)This;
    proxy_stub_hit("SetCurrentTexturePalette");
    return (HRESULT)0;
}

static HRESULT STDMETHODCALLTYPE dev_GetCurrentTexturePalette( struct IDirect3DDevice9 *This, UINT *PaletteNumber )
{
    (void)This;
    proxy_stub_hit("GetCurrentTexturePalette");
    return (HRESULT)0;
}

static HRESULT STDMETHODCALLTYPE dev_SetScissorRect( struct IDirect3DDevice9 *This, const RECT *rect )
{
    (void)This;
    proxy_stub_hit("SetScissorRect");
    return (HRESULT)0;
}

static HRESULT STDMETHODCALLTYPE dev_GetScissorRect( struct IDirect3DDevice9 *This, RECT* pRect )
{
    (void)This;
    proxy_stub_hit("GetScissorRect");
    return (HRESULT)0;
}

static HRESULT STDMETHODCALLTYPE dev_SetSoftwareVertexProcessing( struct IDirect3DDevice9 *This, WINBOOL bSoftware )
{
    (void)This;
    proxy_stub_hit("SetSoftwareVertexProcessing");
    return (HRESULT)0;
}

static WINBOOL STDMETHODCALLTYPE dev_GetSoftwareVertexProcessing( struct IDirect3DDevice9 *This )
{
    (void)This;
    proxy_stub_hit("GetSoftwareVertexProcessing");
    return (WINBOOL)0;
}

static HRESULT STDMETHODCALLTYPE dev_SetNPatchMode( struct IDirect3DDevice9 *This, float nSegments )
{
    (void)This;
    proxy_stub_hit("SetNPatchMode");
    return (HRESULT)0;
}

static float STDMETHODCALLTYPE dev_GetNPatchMode( struct IDirect3DDevice9 *This )
{
    (void)This;
    proxy_stub_hit("GetNPatchMode");
    return (float)0;
}

static HRESULT STDMETHODCALLTYPE dev_DrawPrimitive( struct IDirect3DDevice9 *This, D3DPRIMITIVETYPE PrimitiveType, UINT StartVertex, UINT PrimitiveCount )
{
    (void)This;
    proxy_stub_hit("DrawPrimitive");
    return (HRESULT)0;
}

static HRESULT STDMETHODCALLTYPE dev_DrawIndexedPrimitive( struct IDirect3DDevice9 *This, D3DPRIMITIVETYPE, INT BaseVertexIndex, UINT MinVertexIndex, UINT NumVertices, UINT startIndex, UINT primCount )
{
    (void)This;
    proxy_stub_hit("DrawIndexedPrimitive");
    return (HRESULT)0;
}

static HRESULT STDMETHODCALLTYPE dev_DrawPrimitiveUP( struct IDirect3DDevice9 *This, D3DPRIMITIVETYPE primitive_type,
            UINT primitive_count, const void *data, UINT stride )
{
    (void)This;
    proxy_stub_hit("DrawPrimitiveUP");
    return (HRESULT)0;
}

static HRESULT STDMETHODCALLTYPE dev_DrawIndexedPrimitiveUP( struct IDirect3DDevice9 *This, D3DPRIMITIVETYPE primitive_type, UINT min_vertex_idx, UINT vertex_count,
            UINT primitive_count, const void *index_data, D3DFORMAT index_format, const void *data, UINT stride )
{
    (void)This;
    proxy_stub_hit("DrawIndexedPrimitiveUP");
    return (HRESULT)0;
}

static HRESULT STDMETHODCALLTYPE dev_ProcessVertices( struct IDirect3DDevice9 *This, UINT SrcStartIndex, UINT DestIndex, UINT VertexCount, IDirect3DVertexBuffer9* pDestBuffer, IDirect3DVertexDeclaration9* pVertexDecl, DWORD Flags )
{
    (void)This;
    proxy_stub_hit("ProcessVertices");
    return (HRESULT)0;
}

static HRESULT STDMETHODCALLTYPE dev_CreateVertexDeclaration( struct IDirect3DDevice9 *This, const D3DVERTEXELEMENT9 *elements,
            IDirect3DVertexDeclaration9 **declaration )
{
    (void)This;
    proxy_stub_hit("CreateVertexDeclaration");
    return (HRESULT)0;
}

static HRESULT STDMETHODCALLTYPE dev_SetVertexDeclaration( struct IDirect3DDevice9 *This, IDirect3DVertexDeclaration9* pDecl )
{
    (void)This;
    proxy_stub_hit("SetVertexDeclaration");
    return (HRESULT)0;
}

static HRESULT STDMETHODCALLTYPE dev_GetVertexDeclaration( struct IDirect3DDevice9 *This, IDirect3DVertexDeclaration9** ppDecl )
{
    (void)This;
    proxy_stub_hit("GetVertexDeclaration");
    return (HRESULT)0;
}

static HRESULT STDMETHODCALLTYPE dev_SetFVF( struct IDirect3DDevice9 *This, DWORD FVF )
{
    (void)This;
    proxy_stub_hit("SetFVF");
    return (HRESULT)0;
}

static HRESULT STDMETHODCALLTYPE dev_GetFVF( struct IDirect3DDevice9 *This, DWORD* pFVF )
{
    (void)This;
    proxy_stub_hit("GetFVF");
    return (HRESULT)0;
}

static HRESULT STDMETHODCALLTYPE dev_CreateVertexShader( struct IDirect3DDevice9 *This, const DWORD *byte_code, IDirect3DVertexShader9 **shader )
{
    (void)This;
    proxy_stub_hit("CreateVertexShader");
    return (HRESULT)0;
}

static HRESULT STDMETHODCALLTYPE dev_SetVertexShader( struct IDirect3DDevice9 *This, IDirect3DVertexShader9* pShader )
{
    (void)This;
    proxy_stub_hit("SetVertexShader");
    return (HRESULT)0;
}

static HRESULT STDMETHODCALLTYPE dev_GetVertexShader( struct IDirect3DDevice9 *This, IDirect3DVertexShader9** ppShader )
{
    (void)This;
    proxy_stub_hit("GetVertexShader");
    return (HRESULT)0;
}

static HRESULT STDMETHODCALLTYPE dev_SetVertexShaderConstantF( struct IDirect3DDevice9 *This, UINT reg_idx, const float *data, UINT count )
{
    (void)This;
    proxy_stub_hit("SetVertexShaderConstantF");
    return (HRESULT)0;
}

static HRESULT STDMETHODCALLTYPE dev_GetVertexShaderConstantF( struct IDirect3DDevice9 *This, UINT StartRegister, float* pConstantData, UINT Vector4fCount )
{
    (void)This;
    proxy_stub_hit("GetVertexShaderConstantF");
    return (HRESULT)0;
}

static HRESULT STDMETHODCALLTYPE dev_SetVertexShaderConstantI( struct IDirect3DDevice9 *This, UINT reg_idx, const int *data, UINT count )
{
    (void)This;
    proxy_stub_hit("SetVertexShaderConstantI");
    return (HRESULT)0;
}

static HRESULT STDMETHODCALLTYPE dev_GetVertexShaderConstantI( struct IDirect3DDevice9 *This, UINT StartRegister, int* pConstantData, UINT Vector4iCount )
{
    (void)This;
    proxy_stub_hit("GetVertexShaderConstantI");
    return (HRESULT)0;
}

static HRESULT STDMETHODCALLTYPE dev_SetVertexShaderConstantB( struct IDirect3DDevice9 *This, UINT reg_idx, const WINBOOL *data, UINT count )
{
    (void)This;
    proxy_stub_hit("SetVertexShaderConstantB");
    return (HRESULT)0;
}

static HRESULT STDMETHODCALLTYPE dev_GetVertexShaderConstantB( struct IDirect3DDevice9 *This, UINT StartRegister, WINBOOL* pConstantData, UINT BoolCount )
{
    (void)This;
    proxy_stub_hit("GetVertexShaderConstantB");
    return (HRESULT)0;
}

static HRESULT STDMETHODCALLTYPE dev_SetStreamSource( struct IDirect3DDevice9 *This, UINT StreamNumber, IDirect3DVertexBuffer9* pStreamData, UINT OffsetInBytes, UINT Stride )
{
    (void)This;
    proxy_stub_hit("SetStreamSource");
    return (HRESULT)0;
}

static HRESULT STDMETHODCALLTYPE dev_GetStreamSource( struct IDirect3DDevice9 *This, UINT StreamNumber, IDirect3DVertexBuffer9** ppStreamData, UINT* OffsetInBytes, UINT* pStride )
{
    (void)This;
    proxy_stub_hit("GetStreamSource");
    return (HRESULT)0;
}

static HRESULT STDMETHODCALLTYPE dev_SetStreamSourceFreq( struct IDirect3DDevice9 *This, UINT StreamNumber, UINT Divider )
{
    (void)This;
    proxy_stub_hit("SetStreamSourceFreq");
    return (HRESULT)0;
}

static HRESULT STDMETHODCALLTYPE dev_GetStreamSourceFreq( struct IDirect3DDevice9 *This, UINT StreamNumber, UINT* Divider )
{
    (void)This;
    proxy_stub_hit("GetStreamSourceFreq");
    return (HRESULT)0;
}

static HRESULT STDMETHODCALLTYPE dev_SetIndices( struct IDirect3DDevice9 *This, IDirect3DIndexBuffer9* pIndexData )
{
    (void)This;
    proxy_stub_hit("SetIndices");
    return (HRESULT)0;
}

static HRESULT STDMETHODCALLTYPE dev_GetIndices( struct IDirect3DDevice9 *This, IDirect3DIndexBuffer9** ppIndexData )
{
    (void)This;
    proxy_stub_hit("GetIndices");
    return (HRESULT)0;
}

static HRESULT STDMETHODCALLTYPE dev_CreatePixelShader( struct IDirect3DDevice9 *This, const DWORD *byte_code, IDirect3DPixelShader9 **shader )
{
    (void)This;
    proxy_stub_hit("CreatePixelShader");
    return (HRESULT)0;
}

static HRESULT STDMETHODCALLTYPE dev_SetPixelShader( struct IDirect3DDevice9 *This, IDirect3DPixelShader9* pShader )
{
    (void)This;
    proxy_stub_hit("SetPixelShader");
    return (HRESULT)0;
}

static HRESULT STDMETHODCALLTYPE dev_GetPixelShader( struct IDirect3DDevice9 *This, IDirect3DPixelShader9** ppShader )
{
    (void)This;
    proxy_stub_hit("GetPixelShader");
    return (HRESULT)0;
}

static HRESULT STDMETHODCALLTYPE dev_SetPixelShaderConstantF( struct IDirect3DDevice9 *This, UINT reg_idx, const float *data, UINT count )
{
    (void)This;
    proxy_stub_hit("SetPixelShaderConstantF");
    return (HRESULT)0;
}

static HRESULT STDMETHODCALLTYPE dev_GetPixelShaderConstantF( struct IDirect3DDevice9 *This, UINT StartRegister, float* pConstantData, UINT Vector4fCount )
{
    (void)This;
    proxy_stub_hit("GetPixelShaderConstantF");
    return (HRESULT)0;
}

static HRESULT STDMETHODCALLTYPE dev_SetPixelShaderConstantI( struct IDirect3DDevice9 *This, UINT reg_idx, const int *data, UINT count )
{
    (void)This;
    proxy_stub_hit("SetPixelShaderConstantI");
    return (HRESULT)0;
}

static HRESULT STDMETHODCALLTYPE dev_GetPixelShaderConstantI( struct IDirect3DDevice9 *This, UINT StartRegister, int* pConstantData, UINT Vector4iCount )
{
    (void)This;
    proxy_stub_hit("GetPixelShaderConstantI");
    return (HRESULT)0;
}

static HRESULT STDMETHODCALLTYPE dev_SetPixelShaderConstantB( struct IDirect3DDevice9 *This, UINT reg_idx, const WINBOOL *data, UINT count )
{
    (void)This;
    proxy_stub_hit("SetPixelShaderConstantB");
    return (HRESULT)0;
}

static HRESULT STDMETHODCALLTYPE dev_GetPixelShaderConstantB( struct IDirect3DDevice9 *This, UINT StartRegister, WINBOOL* pConstantData, UINT BoolCount )
{
    (void)This;
    proxy_stub_hit("GetPixelShaderConstantB");
    return (HRESULT)0;
}

static HRESULT STDMETHODCALLTYPE dev_DrawRectPatch( struct IDirect3DDevice9 *This, UINT handle, const float *segment_count, const D3DRECTPATCH_INFO *patch_info )
{
    (void)This;
    proxy_stub_hit("DrawRectPatch");
    return (HRESULT)0;
}

static HRESULT STDMETHODCALLTYPE dev_DrawTriPatch( struct IDirect3DDevice9 *This, UINT handle, const float *segment_count, const D3DTRIPATCH_INFO *patch_info )
{
    (void)This;
    proxy_stub_hit("DrawTriPatch");
    return (HRESULT)0;
}

static HRESULT STDMETHODCALLTYPE dev_DeletePatch( struct IDirect3DDevice9 *This, UINT Handle )
{
    (void)This;
    proxy_stub_hit("DeletePatch");
    return (HRESULT)0;
}

static HRESULT STDMETHODCALLTYPE dev_CreateQuery( struct IDirect3DDevice9 *This, D3DQUERYTYPE Type, IDirect3DQuery9** ppQuery )
{
    (void)This;
    proxy_stub_hit("CreateQuery");
    return (HRESULT)0;
}

static void dev_vtbl_init(IDirect3DDevice9Vtbl *vt)
{
    vt->GetAvailableTextureMem = dev_GetAvailableTextureMem;
    vt->EvictManagedResources = dev_EvictManagedResources;
    vt->GetDeviceCaps = dev_GetDeviceCaps;
    vt->GetDisplayMode = dev_GetDisplayMode;
    vt->GetCreationParameters = dev_GetCreationParameters;
    vt->SetCursorProperties = dev_SetCursorProperties;
    vt->SetCursorPosition = dev_SetCursorPosition;
    vt->ShowCursor = dev_ShowCursor;
    vt->CreateAdditionalSwapChain = dev_CreateAdditionalSwapChain;
    vt->GetSwapChain = dev_GetSwapChain;
    vt->GetNumberOfSwapChains = dev_GetNumberOfSwapChains;
    vt->GetBackBuffer = dev_GetBackBuffer;
    vt->GetRasterStatus = dev_GetRasterStatus;
    vt->SetDialogBoxMode = dev_SetDialogBoxMode;
    vt->SetGammaRamp = dev_SetGammaRamp;
    vt->GetGammaRamp = dev_GetGammaRamp;
    vt->CreateTexture = dev_CreateTexture;
    vt->CreateVolumeTexture = dev_CreateVolumeTexture;
    vt->CreateCubeTexture = dev_CreateCubeTexture;
    vt->CreateVertexBuffer = dev_CreateVertexBuffer;
    vt->CreateIndexBuffer = dev_CreateIndexBuffer;
    vt->CreateRenderTarget = dev_CreateRenderTarget;
    vt->CreateDepthStencilSurface = dev_CreateDepthStencilSurface;
    vt->UpdateSurface = dev_UpdateSurface;
    vt->UpdateTexture = dev_UpdateTexture;
    vt->GetRenderTargetData = dev_GetRenderTargetData;
    vt->GetFrontBufferData = dev_GetFrontBufferData;
    vt->StretchRect = dev_StretchRect;
    vt->ColorFill = dev_ColorFill;
    vt->CreateOffscreenPlainSurface = dev_CreateOffscreenPlainSurface;
    vt->SetRenderTarget = dev_SetRenderTarget;
    vt->GetRenderTarget = dev_GetRenderTarget;
    vt->SetDepthStencilSurface = dev_SetDepthStencilSurface;
    vt->GetDepthStencilSurface = dev_GetDepthStencilSurface;
    vt->SetTransform = dev_SetTransform;
    vt->GetTransform = dev_GetTransform;
    vt->MultiplyTransform = dev_MultiplyTransform;
    vt->SetViewport = dev_SetViewport;
    vt->GetViewport = dev_GetViewport;
    vt->SetMaterial = dev_SetMaterial;
    vt->GetMaterial = dev_GetMaterial;
    vt->SetLight = dev_SetLight;
    vt->GetLight = dev_GetLight;
    vt->LightEnable = dev_LightEnable;
    vt->GetLightEnable = dev_GetLightEnable;
    vt->SetClipPlane = dev_SetClipPlane;
    vt->GetClipPlane = dev_GetClipPlane;
    vt->SetRenderState = dev_SetRenderState;
    vt->GetRenderState = dev_GetRenderState;
    vt->CreateStateBlock = dev_CreateStateBlock;
    vt->BeginStateBlock = dev_BeginStateBlock;
    vt->EndStateBlock = dev_EndStateBlock;
    vt->SetClipStatus = dev_SetClipStatus;
    vt->GetClipStatus = dev_GetClipStatus;
    vt->GetTexture = dev_GetTexture;
    vt->SetTexture = dev_SetTexture;
    vt->GetTextureStageState = dev_GetTextureStageState;
    vt->SetTextureStageState = dev_SetTextureStageState;
    vt->GetSamplerState = dev_GetSamplerState;
    vt->SetSamplerState = dev_SetSamplerState;
    vt->ValidateDevice = dev_ValidateDevice;
    vt->SetPaletteEntries = dev_SetPaletteEntries;
    vt->GetPaletteEntries = dev_GetPaletteEntries;
    vt->SetCurrentTexturePalette = dev_SetCurrentTexturePalette;
    vt->GetCurrentTexturePalette = dev_GetCurrentTexturePalette;
    vt->SetScissorRect = dev_SetScissorRect;
    vt->GetScissorRect = dev_GetScissorRect;
    vt->SetSoftwareVertexProcessing = dev_SetSoftwareVertexProcessing;
    vt->GetSoftwareVertexProcessing = dev_GetSoftwareVertexProcessing;
    vt->SetNPatchMode = dev_SetNPatchMode;
    vt->GetNPatchMode = dev_GetNPatchMode;
    vt->DrawPrimitive = dev_DrawPrimitive;
    vt->DrawIndexedPrimitive = dev_DrawIndexedPrimitive;
    vt->DrawPrimitiveUP = dev_DrawPrimitiveUP;
    vt->DrawIndexedPrimitiveUP = dev_DrawIndexedPrimitiveUP;
    vt->ProcessVertices = dev_ProcessVertices;
    vt->CreateVertexDeclaration = dev_CreateVertexDeclaration;
    vt->SetVertexDeclaration = dev_SetVertexDeclaration;
    vt->GetVertexDeclaration = dev_GetVertexDeclaration;
    vt->SetFVF = dev_SetFVF;
    vt->GetFVF = dev_GetFVF;
    vt->CreateVertexShader = dev_CreateVertexShader;
    vt->SetVertexShader = dev_SetVertexShader;
    vt->GetVertexShader = dev_GetVertexShader;
    vt->SetVertexShaderConstantF = dev_SetVertexShaderConstantF;
    vt->GetVertexShaderConstantF = dev_GetVertexShaderConstantF;
    vt->SetVertexShaderConstantI = dev_SetVertexShaderConstantI;
    vt->GetVertexShaderConstantI = dev_GetVertexShaderConstantI;
    vt->SetVertexShaderConstantB = dev_SetVertexShaderConstantB;
    vt->GetVertexShaderConstantB = dev_GetVertexShaderConstantB;
    vt->SetStreamSource = dev_SetStreamSource;
    vt->GetStreamSource = dev_GetStreamSource;
    vt->SetStreamSourceFreq = dev_SetStreamSourceFreq;
    vt->GetStreamSourceFreq = dev_GetStreamSourceFreq;
    vt->SetIndices = dev_SetIndices;
    vt->GetIndices = dev_GetIndices;
    vt->CreatePixelShader = dev_CreatePixelShader;
    vt->SetPixelShader = dev_SetPixelShader;
    vt->GetPixelShader = dev_GetPixelShader;
    vt->SetPixelShaderConstantF = dev_SetPixelShaderConstantF;
    vt->GetPixelShaderConstantF = dev_GetPixelShaderConstantF;
    vt->SetPixelShaderConstantI = dev_SetPixelShaderConstantI;
    vt->GetPixelShaderConstantI = dev_GetPixelShaderConstantI;
    vt->SetPixelShaderConstantB = dev_SetPixelShaderConstantB;
    vt->GetPixelShaderConstantB = dev_GetPixelShaderConstantB;
    vt->DrawRectPatch = dev_DrawRectPatch;
    vt->DrawTriPatch = dev_DrawTriPatch;
    vt->DeletePatch = dev_DeletePatch;
    vt->CreateQuery = dev_CreateQuery;
}

