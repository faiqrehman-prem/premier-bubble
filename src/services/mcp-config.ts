import fs from "fs";
import path from "path";
import os from "os";
import { McpConfig } from "../types/types";

/**
 * Environment variable prefixes for MCP server configuration
 */
const MCP_SERVER_ENV_PREFIX = "MCP_SERVER_";
const MCP_SERVER_TOKEN_PREFIX = "MCP_SERVER_TOKEN_";

export class McpConfigLoader {
  private static CONFIG_PATHS = [
    // 项目配置路径
    path.join(process.cwd(), "mcp_config.json"),
    // 后端根路径配置
    path.join(__dirname, "../../mcp_config.json"),
    // 环境变量指定的配置路径
    process.env.MCP_CONFIG_PATH,
  ];

  /**
   * 加载 MCP 配置
   */
  static loadConfig(): McpConfig {
    // 默认空配置
    const defaultConfig: McpConfig = {
      mcpServers: {},
    };

    // 1. 首先尝试从文件加载基本配置
    let fileConfig = defaultConfig;
    for (const configPath of this.CONFIG_PATHS) {
      if (configPath && fs.existsSync(configPath)) {
        try {
          const configContent = fs.readFileSync(configPath, "utf-8");
          fileConfig = JSON.parse(configContent) as McpConfig;
          console.log(`已从 ${configPath} 加载基本 MCP 配置`);
          break;
        } catch (error) {
          console.error(`加载 MCP 配置文件 ${configPath} 失败: ${error}`);
        }
      }
    }

    // 2. 然后从环境变量加载MCP服务器配置并合并
    const envConfig = this.loadConfigFromEnvironment();
    
    // 3. 合并配置，环境变量优先级高于文件配置
    const mergedConfig: McpConfig = {
      mcpServers: {
        ...fileConfig.mcpServers,
        ...envConfig.mcpServers,
      },
    };
    
    // 4. 应用环境变量中的token到现有配置
    this.applyTokensFromEnvironment(mergedConfig);
    
    // 如果没有任何服务器配置，提示用户
    if (Object.keys(mergedConfig.mcpServers).length === 0) {
      // Silently use empty configuration - no logging needed
    } else {
      const serverCount = Object.keys(mergedConfig.mcpServers).length;
      console.log(`已加载 ${serverCount} 个 MCP 服务器配置`);
    }
    
    return mergedConfig;
  }

  /**
   * 从环境变量加载MCP服务器配置
   * 环境变量格式: MCP_SERVER_NAME={"command":"npm","args":[...],"disabled":false}
   */
  private static loadConfigFromEnvironment(): McpConfig {
    const envConfig: McpConfig = {
      mcpServers: {},
    };
    
    // 查找所有MCP_SERVER_前缀的环境变量
    for (const [key, value] of Object.entries(process.env)) {
      if (key.startsWith(MCP_SERVER_ENV_PREFIX) && value) {
        try {
          // 提取服务器名称和配置
          const serverName = key.substring(MCP_SERVER_ENV_PREFIX.length);
          if (serverName) {
            // 尝试解析JSON配置
            const serverConfig = JSON.parse(value);
            envConfig.mcpServers[serverName] = serverConfig;
            console.log(`从环境变量加载了MCP服务器配置: ${serverName}`);
          }
        } catch (error) {
          console.error(`解析环境变量 ${key} 失败: ${error}`);
        }
      }
    }
    
    return envConfig;
  }
  
  /**
   * 应用来自环境变量的Token到现有配置
   * 环境变量格式: MCP_SERVER_TOKEN_NAME=your-token-value
   */
  private static applyTokensFromEnvironment(config: McpConfig): void {
    for (const [key, value] of Object.entries(process.env)) {
      if (key.startsWith(MCP_SERVER_TOKEN_PREFIX) && value) {
        const serverName = key.substring(MCP_SERVER_TOKEN_PREFIX.length);
        
        if (serverName && config.mcpServers[serverName]) {
          // 为服务器配置添加或更新token
          if (config.mcpServers[serverName].token !== value) {
            console.log(`已应用环境变量中的Token到服务器: ${serverName}`);
            config.mcpServers[serverName].token = value;
          }
        }
      }
    }
  }
  
  /**
   * 保存 MCP 配置
   */
  static saveConfig(config: McpConfig, configPath?: string): boolean {
    const savePath = configPath || this.CONFIG_PATHS[0];

    if (!savePath) {
      console.error("未指定配置保存路径");
      return false;
    }

    try {
      // 确保目录存在
      const dirPath = path.dirname(savePath);
      if (!fs.existsSync(dirPath)) {
        fs.mkdirSync(dirPath, { recursive: true });
      }

      fs.writeFileSync(savePath, JSON.stringify(config, null, 2), "utf-8");
      console.log(`MCP 配置已保存到 ${savePath}`);
      return true;
    } catch (error) {
      console.error(`保存 MCP 配置到 ${savePath} 失败: ${error}`);
      return false;
    }
  }
}
