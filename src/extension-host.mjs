export const extensionKinds = Object.freeze(['source','metadata','lyrics','queue-order','presentation']);
export function createExtensionHost({ plugins = [], isEnabled = () => false } = {}) {
  const registry=new Map();
  for(const plugin of plugins) {
    if(!plugin || !/^[a-z][a-z0-9.-]{2,79}$/u.test(plugin.id) || !extensionKinds.includes(plugin.kind) || !plugin.methods || registry.has(plugin.id)) throw new Error('插件注册信息无效。');
    registry.set(plugin.id,plugin);
  }
  return Object.freeze({
    list:()=>[...registry.values()].map(({id,name,kind,network})=>({id,name,kind,network:Boolean(network)})),
    async invoke(id,method,input) {
      const plugin=registry.get(id);
      if(!plugin || !Object.hasOwn(plugin.methods,method) || typeof plugin.methods[method]!=='function') throw new Error('插件能力尚未注册。');
      if(!isEnabled(id)) throw new Error('插件已关闭，请在功能插件中明确开启。');
      return plugin.methods[method](input);
    },
  });
}
