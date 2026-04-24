const DOCS_URL = 'https://www.kdocs.cn/l/cgMS9PoVquM0';

export function DocsPage() {
  return (
    <div className='flex flex-col' style={{ height: 'calc(100vh - 64px)' }}>
      <iframe
        src={DOCS_URL}
        title='文档'
        className='w-full flex-1 border-0'
        allow='fullscreen'
      />
    </div>
  );
}
