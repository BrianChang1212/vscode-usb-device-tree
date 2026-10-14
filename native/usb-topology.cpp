#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#include <winioctl.h>
#include <setupapi.h>
#include <cfgmgr32.h>
#include <initguid.h>
#include <devpkey.h>
#include <objbase.h>
#include <usbiodef.h>
#include <usbioctl.h>
#include <usbspec.h>

#include <algorithm>
#include <cctype>
#include <cstddef>
#include <cstdint>
#include <iostream>
#include <map>
#include <set>
#include <sstream>
#include <string>
#include <vector>

#pragma comment(lib, "setupapi.lib")
#pragma comment(lib, "cfgmgr32.lib")
#pragma comment(lib, "advapi32.lib")
#pragma comment(lib, "ole32.lib")

namespace {

constexpr DWORD kMaxNodes = 25000;
constexpr unsigned kMaxDepth = 64;

std::string utf8(const std::wstring& value) {
  if (value.empty()) return {};
  int size = WideCharToMultiByte(CP_UTF8, 0, value.data(),
      static_cast<int>(value.size()), nullptr, 0, nullptr, nullptr);
  std::string result(size, '\0');
  WideCharToMultiByte(CP_UTF8, 0, value.data(),
      static_cast<int>(value.size()), result.data(), size, nullptr, nullptr);
  return result;
}

std::string json(const std::string& value) {
  std::ostringstream out;
  out << '"';
  for (unsigned char ch : value) {
    switch (ch) {
      case '"': out << "\\\""; break;
      case '\\': out << "\\\\"; break;
      case '\b': out << "\\b"; break;
      case '\f': out << "\\f"; break;
      case '\n': out << "\\n"; break;
      case '\r': out << "\\r"; break;
      case '\t': out << "\\t"; break;
      default:
        if (ch < 0x20) {
          const char* hex = "0123456789abcdef";
          out << "\\u00" << hex[ch >> 4] << hex[ch & 0x0f];
        } else {
          out << ch;
        }
    }
  }
  out << '"';
  return out.str();
}

std::string existingInfPath(const std::wstring& name) {
  if (name.empty() || name.find_first_of(L"\\/:") != std::wstring::npos) return {};
  wchar_t directory[MAX_PATH]{};
  const UINT length = GetWindowsDirectoryW(directory, MAX_PATH);
  if (!length || length >= MAX_PATH) return {};
  const std::wstring path = std::wstring(directory) + L"\\INF\\" + name;
  const DWORD attributes = GetFileAttributesW(path.c_str());
  return attributes != INVALID_FILE_ATTRIBUTES && !(attributes & FILE_ATTRIBUTE_DIRECTORY)
      ? utf8(path) : std::string();
}

std::string serviceBinaryPath(const std::wstring& serviceName) {
  if (serviceName.empty()) return {};
  SC_HANDLE manager = OpenSCManagerW(nullptr, nullptr, SC_MANAGER_CONNECT);
  if (!manager) return {};
  SC_HANDLE service = OpenServiceW(manager, serviceName.c_str(), SERVICE_QUERY_CONFIG);
  std::string path;
  if (service) {
    DWORD required = 0;
    QueryServiceConfigW(service, nullptr, 0, &required);
    if (required >= sizeof(QUERY_SERVICE_CONFIGW) && required <= 64 * 1024) {
      std::vector<BYTE> buffer(required, 0);
      auto* config = reinterpret_cast<QUERY_SERVICE_CONFIGW*>(buffer.data());
      if (QueryServiceConfigW(service, config, required, &required) &&
          config->lpBinaryPathName) path = utf8(config->lpBinaryPathName);
    }
    CloseServiceHandle(service);
  }
  CloseServiceHandle(manager);
  return path;
}

struct Handle {
  HANDLE value = INVALID_HANDLE_VALUE;
  explicit Handle(HANDLE h) : value(h) {}
  ~Handle() { if (value != INVALID_HANDLE_VALUE) CloseHandle(value); }
  Handle(const Handle&) = delete;
  Handle& operator=(const Handle&) = delete;
};

struct DeviceInfoSet {
  HDEVINFO value = INVALID_HANDLE_VALUE;
  explicit DeviceInfoSet(HDEVINFO h) : value(h) {}
  ~DeviceInfoSet() { if (value != INVALID_HANDLE_VALUE) SetupDiDestroyDeviceInfoList(value); }
};

std::wstring queryDriverKeyName(HANDLE hub, ULONG port) {
  std::vector<char> buffer(8192, 0);
  auto* name = reinterpret_cast<USB_NODE_CONNECTION_DRIVERKEY_NAME*>(buffer.data());
  name->ConnectionIndex = port;
  DWORD returned = 0;
  if (!DeviceIoControl(hub, IOCTL_USB_GET_NODE_CONNECTION_DRIVERKEY_NAME,
      name, sizeof(ULONG), name, static_cast<DWORD>(buffer.size()), &returned, nullptr)) return {};
  if (name->ActualLength <= offsetof(USB_NODE_CONNECTION_DRIVERKEY_NAME, DriverKeyName) ||
      name->ActualLength > buffer.size()) return {};
  return name->DriverKeyName;
}

std::wstring queryControllerDriverKeyName(HANDLE controller) {
  std::vector<char> buffer(8192, 0);
  auto* name = reinterpret_cast<USB_HCD_DRIVERKEY_NAME*>(buffer.data());
  DWORD returned = 0;
  if (!DeviceIoControl(controller, IOCTL_GET_HCD_DRIVERKEY_NAME,
      nullptr, 0, name, static_cast<DWORD>(buffer.size()), &returned, nullptr)) return {};
  if (name->ActualLength <= offsetof(USB_HCD_DRIVERKEY_NAME, DriverKeyName) ||
      name->ActualLength > buffer.size()) return {};
  return name->DriverKeyName;
}

struct SerialPortInfo {
  std::string portName;
  std::string friendlyName;
  std::string instanceId;
  std::string serviceName;
};

struct PnpInfo {
  std::map<std::string, std::string> properties;
  std::vector<SerialPortInfo> serialPorts;
  std::string childrenJson = "[]";
};

std::wstring devnodeString(DEVINST devnode, ULONG property);
std::wstring devnodeMultiString(DEVINST devnode, ULONG property);
std::wstring devnodeInstanceId(DEVINST devnode);
std::string interfacePathsForInstance(const std::string& instanceId);
std::string pnpJson(const std::map<std::string, std::string>& properties);

std::string pnpDescendantNode(DEVINST devnode,
    const std::vector<SerialPortInfo>& serialPorts, unsigned depth,
    unsigned& count, std::set<DEVINST>& visited) {
  const std::wstring instanceId = devnodeInstanceId(devnode);
  const std::wstring friendly = devnodeString(devnode, CM_DRP_FRIENDLYNAME);
  const std::wstring description = devnodeString(devnode, CM_DRP_DEVICEDESC);
  std::map<std::string, std::string> properties;
  const std::pair<const char*, ULONG> requested[] = {
    {"friendlyName", CM_DRP_FRIENDLYNAME}, {"pnpDescription", CM_DRP_DEVICEDESC},
    {"serviceName", CM_DRP_SERVICE}, {"pnpManufacturer", CM_DRP_MFG},
    {"setupClass", CM_DRP_CLASS}, {"classGuid", CM_DRP_CLASSGUID},
    {"enumeratorName", CM_DRP_ENUMERATOR_NAME},
    {"locationInformation", CM_DRP_LOCATION_INFORMATION},
    {"kernelName", CM_DRP_PHYSICAL_DEVICE_OBJECT_NAME},
  };
  for (const auto& item : requested) {
    const auto value = devnodeString(devnode, item.second);
    if (!value.empty()) properties[item.first] = utf8(value);
  }
  const auto binaryPath = serviceBinaryPath(devnodeString(devnode, CM_DRP_SERVICE));
  if (!binaryPath.empty()) properties["driverBinaryPath"] = binaryPath;
  if (!instanceId.empty()) properties["instanceId"] = utf8(instanceId);
  const auto interfacePaths = interfacePathsForInstance(utf8(instanceId));
  if (!interfacePaths.empty()) properties["deviceInterfacePaths"] = interfacePaths;
  for (const auto& item : std::vector<std::pair<const char*, ULONG>>{
      {"hardwareIds", CM_DRP_HARDWAREID}, {"compatibleIds", CM_DRP_COMPATIBLEIDS},
      {"locationPaths", CM_DRP_LOCATION_PATHS},
      {"lowerFilters", CM_DRP_LOWERFILTERS}, {"upperFilters", CM_DRP_UPPERFILTERS}}) {
    const auto value = devnodeMultiString(devnode, item.second);
    if (!value.empty()) properties[item.first] = utf8(value);
  }
  for (const auto& item : std::vector<std::pair<const char*, ULONG>>{
      {"pnpAddress", CM_DRP_ADDRESS}, {"pnpCapabilities", CM_DRP_CAPABILITIES},
      {"pnpConfigFlags", CM_DRP_CONFIGFLAGS}, {"legacyBusType", CM_DRP_LEGACYBUSTYPE}}) {
    ULONG type = 0, value = 0, bytes = sizeof(value);
    if (CM_Get_DevNode_Registry_PropertyW(devnode, item.second, &type,
        &value, &bytes, 0) == CR_SUCCESS && type == REG_DWORD) {
      std::ostringstream formatted;
      formatted << "0x" << std::hex << value;
      properties[item.first] = formatted.str();
    }
  }
  const auto driverKey = devnodeString(devnode, CM_DRP_DRIVER);
  if (!driverKey.empty()) properties["driverKeyName"] = utf8(driverKey);
  HKEY softwareKey = nullptr;
  if (CM_Open_DevNode_Key(devnode, KEY_READ, 0, RegDisposition_OpenExisting,
      &softwareKey, CM_REGISTRY_SOFTWARE) == CR_SUCCESS) {
    const std::pair<const char*, const wchar_t*> values[] = {
      {"driverInf", L"InfPath"}, {"driverDescription", L"DriverDesc"},
      {"driverProvider", L"ProviderName"}, {"driverVersion", L"DriverVersion"},
      {"driverDate", L"DriverDate"},
    };
    for (const auto& item : values) {
      wchar_t value[2048]{};
      DWORD type = 0, bytes = sizeof(value) - sizeof(wchar_t);
      if (RegQueryValueExW(softwareKey, item.second, nullptr, &type,
          reinterpret_cast<PBYTE>(value), &bytes) == ERROR_SUCCESS &&
          type == REG_SZ && value[0]) {
        properties[item.first] = utf8(value);
        if (std::string(item.first) == "driverInf") {
          const auto path = existingInfPath(value);
          if (!path.empty()) properties["driverInfPath"] = path;
        }
      }
    }
    RegCloseKey(softwareKey);
  }
  ULONG status = 0, problem = 0;
  if (CM_Get_DevNode_Status(&status, &problem, devnode, 0) == CR_SUCCESS) {
    std::ostringstream formatted;
    formatted << "0x" << std::hex << status;
    properties["devNodeStatus"] = formatted.str();
    properties["problemCode"] = std::to_string(problem);
  }
  GUID containerId{};
  DEVPROPTYPE containerType = 0;
  ULONG propertyLength = sizeof(containerId);
  if (CM_Get_DevNode_PropertyW(devnode, &DEVPKEY_Device_ContainerId,
      &containerType, reinterpret_cast<PBYTE>(&containerId),
      &propertyLength, 0) == CR_SUCCESS &&
      containerType == DEVPROP_TYPE_GUID && propertyLength == sizeof(containerId)) {
    wchar_t formatted[40]{};
    if (StringFromGUID2(containerId, formatted, 40)) properties["containerId"] = utf8(formatted);
  }
  CM_POWER_DATA powerData{};
  ULONG powerType = 0;
  propertyLength = sizeof(powerData);
  if (CM_Get_DevNode_Registry_PropertyW(devnode, CM_DRP_DEVICE_POWER_DATA,
      &powerType, &powerData, &propertyLength, 0) == CR_SUCCESS &&
      powerType == REG_BINARY &&
      propertyLength >= offsetof(CM_POWER_DATA, PD_MostRecentPowerState) +
          sizeof(powerData.PD_MostRecentPowerState) &&
      powerData.PD_MostRecentPowerState >= PowerDeviceD0 &&
      powerData.PD_MostRecentPowerState <= PowerDeviceD3) {
    properties["powerState"] = "D" + std::to_string(
        powerData.PD_MostRecentPowerState - PowerDeviceD0);
  }
  const auto instance = utf8(instanceId);
  std::string portName;
  for (const auto& port : serialPorts) {
    if (_stricmp(port.instanceId.c_str(), instance.c_str()) == 0) {
      portName = port.portName;
      break;
    }
  }
  std::ostringstream out;
  out << "{\"type\":\"pnpDevice\",\"name\":"
      << json(utf8(friendly.empty() ? description : friendly))
      << ",\"instanceId\":" << json(instance)
      << ",\"pnpProperties\":" << pnpJson(properties);
  if (!portName.empty()) out << ",\"portName\":" << json(portName);
  if (depth >= 16 || count++ >= 256 || !visited.insert(devnode).second) {
    out << ",\"children\":[],\"error\":\"topologyLimitExceeded\"}";
    return out.str();
  }
  out << ",\"children\":[";
  DEVINST child = 0;
  if (CM_Get_Child(&child, devnode, 0) == CR_SUCCESS) {
    bool first = true;
    for (unsigned sibling = 0; sibling < 256 && child; ++sibling) {
      if (!first) out << ',';
      first = false;
      out << pnpDescendantNode(child, serialPorts, depth + 1, count, visited);
      DEVINST next = 0;
      if (CM_Get_Sibling(&next, child, 0) != CR_SUCCESS) break;
      child = next;
    }
  }
  out << "]}";
  return out.str();
}

bool isComPortName(const std::wstring& name) {
  if (name.size() < 4 || name.compare(0, 3, L"COM") != 0) return false;
  for (size_t i = 3; i < name.size(); ++i) {
    if (name[i] < L'0' || name[i] > L'9') return false;
  }
  return true;
}

PnpInfo queryPnpProperties(const std::wstring& driverKey, bool collectSerialPorts) {
  PnpInfo result;
  auto& properties = result.properties;
  if (driverKey.empty()) return result;
  DeviceInfoSet devices(SetupDiGetClassDevsW(nullptr, nullptr, nullptr,
      DIGCF_ALLCLASSES | DIGCF_PRESENT));
  if (devices.value == INVALID_HANDLE_VALUE) return result;
  auto readString = [](HDEVINFO set, SP_DEVINFO_DATA* device, DWORD property) {
    DWORD type = 0, required = 0;
    SetupDiGetDeviceRegistryPropertyW(set, device, property, &type, nullptr, 0, &required);
    if (!required || required > 64 * 1024) return std::wstring();
    std::vector<BYTE> buffer(required + sizeof(wchar_t), 0);
    if (!SetupDiGetDeviceRegistryPropertyW(set, device, property, &type,
        buffer.data(), required, nullptr) || type != REG_SZ) return std::wstring();
    return std::wstring(reinterpret_cast<const wchar_t*>(buffer.data()));
  };
  auto readMultiString = [](HDEVINFO set, SP_DEVINFO_DATA* device, DWORD property) {
    DWORD type = 0, required = 0;
    SetupDiGetDeviceRegistryPropertyW(set, device, property, &type, nullptr, 0, &required);
    if (!required || required > 64 * 1024) return std::wstring();
    std::vector<wchar_t> buffer(required / sizeof(wchar_t) + 2, L'\0');
    if (!SetupDiGetDeviceRegistryPropertyW(set, device, property, &type,
        reinterpret_cast<PBYTE>(buffer.data()), required, nullptr) || type != REG_MULTI_SZ) {
      return std::wstring();
    }
    std::wstring joined;
    for (const wchar_t* item = buffer.data(); *item; item += wcslen(item) + 1) {
      if (!joined.empty()) joined += L" | ";
      joined += item;
    }
    return joined;
  };
  for (DWORD index = 0; index < 65536; ++index) {
    SP_DEVINFO_DATA device{};
    device.cbSize = sizeof(device);
    if (!SetupDiEnumDeviceInfo(devices.value, index, &device)) break;
    const std::wstring candidate = readString(devices.value, &device, SPDRP_DRIVER);
    if (candidate.empty() || _wcsicmp(candidate.c_str(), driverKey.c_str()) != 0) continue;
    const std::pair<const char*, DWORD> requested[] = {
      {"pnpDescription", SPDRP_DEVICEDESC}, {"pnpManufacturer", SPDRP_MFG},
      {"serviceName", SPDRP_SERVICE}, {"friendlyName", SPDRP_FRIENDLYNAME},
      {"locationInformation", SPDRP_LOCATION_INFORMATION},
      {"setupClass", SPDRP_CLASS}, {"classGuid", SPDRP_CLASSGUID},
      {"enumeratorName", SPDRP_ENUMERATOR_NAME},
      {"kernelName", SPDRP_PHYSICAL_DEVICE_OBJECT_NAME},
    };
    for (const auto& item : requested) {
      const std::wstring value = readString(devices.value, &device, item.second);
      if (!value.empty()) properties[item.first] = utf8(value);
    }
    const auto binaryPath = serviceBinaryPath(readString(devices.value, &device, SPDRP_SERVICE));
    if (!binaryPath.empty()) properties["driverBinaryPath"] = binaryPath;
    for (const auto& item : std::vector<std::pair<const char*, DWORD>>{
        {"hardwareIds", SPDRP_HARDWAREID}, {"compatibleIds", SPDRP_COMPATIBLEIDS},
        {"locationPaths", SPDRP_LOCATION_PATHS}}) {
      const std::wstring value = readMultiString(devices.value, &device, item.second);
      if (!value.empty()) properties[item.first] = utf8(value);
    }
    for (const auto& item : std::vector<std::pair<const char*, DWORD>>{
        {"pnpAddress", SPDRP_ADDRESS}, {"pnpCapabilities", SPDRP_CAPABILITIES},
        {"pnpConfigFlags", SPDRP_CONFIGFLAGS}}) {
      DWORD type = 0, value = 0;
      if (SetupDiGetDeviceRegistryPropertyW(devices.value, &device, item.second,
          &type, reinterpret_cast<PBYTE>(&value), sizeof(value), nullptr) &&
          type == REG_DWORD) {
        std::ostringstream formatted;
        formatted << "0x" << std::hex << value;
        properties[item.first] = formatted.str();
      }
    }
    ULONG status = 0, problem = 0;
    if (CM_Get_DevNode_Status(&status, &problem, device.DevInst, 0) == CR_SUCCESS) {
      std::ostringstream formatted;
      formatted << "0x" << std::hex << status;
      properties["devNodeStatus"] = formatted.str();
      properties["problemCode"] = std::to_string(problem);
    }
    GUID containerId{};
    DEVPROPTYPE containerType = 0;
    DWORD propertyLength = 0;
    if (SetupDiGetDevicePropertyW(devices.value, &device, &DEVPKEY_Device_ContainerId,
        &containerType, reinterpret_cast<PBYTE>(&containerId), sizeof(containerId),
        &propertyLength, 0) && containerType == DEVPROP_TYPE_GUID &&
        propertyLength == sizeof(containerId)) {
      wchar_t formatted[40]{};
      if (StringFromGUID2(containerId, formatted, 40)) properties["containerId"] = utf8(formatted);
    }
    CM_POWER_DATA powerData{};
    DWORD powerType = 0;
    propertyLength = 0;
    if (SetupDiGetDeviceRegistryPropertyW(devices.value, &device,
        SPDRP_DEVICE_POWER_DATA, &powerType, reinterpret_cast<PBYTE>(&powerData),
        sizeof(powerData), &propertyLength) && powerType == REG_BINARY &&
        propertyLength >= offsetof(CM_POWER_DATA, PD_MostRecentPowerState) +
            sizeof(powerData.PD_MostRecentPowerState) &&
        powerData.PD_MostRecentPowerState >= PowerDeviceD0 &&
        powerData.PD_MostRecentPowerState <= PowerDeviceD3) {
      properties["powerState"] = "D" + std::to_string(
          powerData.PD_MostRecentPowerState - PowerDeviceD0);
    }
    HKEY driverKeyHandle = SetupDiOpenDevRegKey(devices.value, &device,
        DICS_FLAG_GLOBAL, 0, DIREG_DRV, KEY_READ);
    if (driverKeyHandle != INVALID_HANDLE_VALUE) {
      const std::pair<const char*, const wchar_t*> driverValues[] = {
        {"driverInf", L"InfPath"}, {"driverDescription", L"DriverDesc"},
        {"driverProvider", L"ProviderName"}, {"driverVersion", L"DriverVersion"},
        {"driverDate", L"DriverDate"},
      };
      for (const auto& item : driverValues) {
        wchar_t value[2048]{};
        DWORD type = 0, bytes = sizeof(value) - sizeof(wchar_t);
        if (RegQueryValueExW(driverKeyHandle, item.second, nullptr, &type,
            reinterpret_cast<PBYTE>(value), &bytes) == ERROR_SUCCESS &&
            type == REG_SZ && value[0]) {
          properties[item.first] = utf8(value);
          if (std::string(item.first) == "driverInf") {
            const auto path = existingInfPath(value);
            if (!path.empty()) properties["driverInfPath"] = path;
          }
        }
      }
      RegCloseKey(driverKeyHandle);
    }
    DWORD instanceLength = 0;
    SetupDiGetDeviceInstanceIdW(devices.value, &device, nullptr, 0, &instanceLength);
    if (instanceLength && instanceLength < 32768) {
      std::vector<wchar_t> instance(instanceLength + 1, L'\0');
      if (SetupDiGetDeviceInstanceIdW(devices.value, &device, instance.data(),
          static_cast<DWORD>(instance.size()), nullptr)) {
        properties["instanceId"] = utf8(instance.data());
      }
    }
    if (properties.count("instanceId")) {
      const auto paths = interfacePathsForInstance(properties["instanceId"]);
      if (!paths.empty()) properties["deviceInterfacePaths"] = paths;
    }
    std::wstring childIds;
    DEVINST child = 0;
    if (CM_Get_Child(&child, device.DevInst, 0) == CR_SUCCESS) {
      for (unsigned childCount = 0; childCount < 64 && child; ++childCount) {
        ULONG chars = 0;
        if (CM_Get_Device_ID_Size(&chars, child, 0) == CR_SUCCESS && chars < 32768) {
          std::vector<wchar_t> childId(chars + 1, L'\0');
          if (CM_Get_Device_IDW(child, childId.data(),
              static_cast<ULONG>(childId.size()), 0) == CR_SUCCESS) {
            if (!childIds.empty()) childIds += L" | ";
            childIds += childId.data();
          }
        }
        DEVINST sibling = 0;
        if (CM_Get_Sibling(&sibling, child, 0) != CR_SUCCESS) break;
        child = sibling;
      }
    }
    if (!childIds.empty()) properties["childInstanceIds"] = utf8(childIds);
    if (!collectSerialPorts) break;
    // A serial interface can be this devnode or a descendant of a composite USB device.
    // Only follow this device's PnP subtree; a machine-wide COM scan would misattribute ports.
    std::vector<DEVINST> pending{device.DevInst};
    std::set<DEVINST> visited;
    for (size_t cursor = 0; cursor < pending.size() && cursor < 256; ++cursor) {
      const DEVINST current = pending[cursor];
      if (!visited.insert(current).second) continue;
      ULONG chars = 0;
      if (CM_Get_Device_ID_Size(&chars, current, 0) != CR_SUCCESS || chars >= 32768) continue;
      std::vector<wchar_t> instance(chars + 1, L'\0');
      if (CM_Get_Device_IDW(current, instance.data(), static_cast<ULONG>(instance.size()), 0) != CR_SUCCESS) continue;
      SP_DEVINFO_DATA member{};
      member.cbSize = sizeof(member);
      if (SetupDiOpenDeviceInfoW(devices.value, instance.data(), nullptr, 0, &member)) {
        HKEY key = SetupDiOpenDevRegKey(devices.value, &member, DICS_FLAG_GLOBAL,
            0, DIREG_DEV, KEY_READ);
        if (key != INVALID_HANDLE_VALUE) {
          wchar_t portName[128]{};
          DWORD type = 0;
          DWORD bytes = sizeof(portName) - sizeof(wchar_t);
          const LONG registryStatus = RegQueryValueExW(key, L"PortName", nullptr, &type,
              reinterpret_cast<BYTE*>(portName), &bytes);
          RegCloseKey(key);
          if (registryStatus == ERROR_SUCCESS && type == REG_SZ && isComPortName(portName)) {
            result.serialPorts.push_back({utf8(portName),
                utf8(readString(devices.value, &member, SPDRP_FRIENDLYNAME)),
                utf8(instance.data()),
                utf8(readString(devices.value, &member, SPDRP_SERVICE))});
          }
        }
      }
      DEVINST descendant = 0;
      if (CM_Get_Child(&descendant, current, 0) != CR_SUCCESS) continue;
      for (unsigned siblings = 0; siblings < 256 && pending.size() < 256; ++siblings) {
        pending.push_back(descendant);
        DEVINST next = 0;
        if (CM_Get_Sibling(&next, descendant, 0) != CR_SUCCESS) break;
        descendant = next;
      }
    }
    std::ostringstream descendants;
    descendants << '[';
    DEVINST descendant = 0;
    if (CM_Get_Child(&descendant, device.DevInst, 0) == CR_SUCCESS) {
      bool first = true;
      unsigned descendantCount = 0;
      std::set<DEVINST> visitedDescendants;
      for (unsigned sibling = 0; sibling < 256 && descendant; ++sibling) {
        if (!first) descendants << ',';
        first = false;
        descendants << pnpDescendantNode(descendant, result.serialPorts, 1,
            descendantCount, visitedDescendants);
        DEVINST next = 0;
        if (CM_Get_Sibling(&next, descendant, 0) != CR_SUCCESS) break;
        descendant = next;
      }
    }
    descendants << ']';
    result.childrenJson = descendants.str();
    break;
  }
  return result;
}

std::string pnpJson(const std::map<std::string, std::string>& properties) {
  std::ostringstream out;
  out << '{';
  bool first = true;
  for (const auto& item : properties) {
    if (!first) out << ',';
    first = false;
    out << json(item.first) << ':' << json(item.second);
  }
  out << '}';
  return out.str();
}

std::string serialPortsJson(const std::vector<SerialPortInfo>& ports) {
  std::ostringstream out;
  out << '[';
  for (size_t i = 0; i < ports.size(); ++i) {
    if (i) out << ',';
    out << "{\"portName\":" << json(ports[i].portName)
        << ",\"friendlyName\":" << json(ports[i].friendlyName)
        << ",\"instanceId\":" << json(ports[i].instanceId)
        << ",\"serviceName\":" << json(ports[i].serviceName) << '}';
  }
  out << ']';
  return out.str();
}

std::string connectionStatusName(ULONG status) {
  switch (status) {
    case NoDeviceConnected: return "disconnected";
    case DeviceConnected: return "connected";
    case DeviceFailedEnumeration: return "enumerationFailed";
    case DeviceGeneralFailure: return "generalFailure";
    case DeviceCausedOvercurrent: return "overcurrent";
    case DeviceNotEnoughPower: return "insufficientPower";
    case DeviceNotEnoughBandwidth: return "insufficientBandwidth";
    case DeviceHubNestedTooDeeply: return "hubDepthExceeded";
    case DeviceInLegacyHub: return "legacyHub";
    case DeviceEnumerating: return "enumerating";
    case DeviceReset: return "resetting";
    default: return "unknown";
  }
}

std::string speedName(USB_DEVICE_SPEED speed) {
  switch (speed) {
    case UsbLowSpeed: return "low";
    case UsbFullSpeed: return "full";
    case UsbHighSpeed: return "high";
    case UsbSuperSpeed: return "super";
    default: return "unknown";
  }
}

std::wstring hubDevicePath(const std::wstring& symbolicName) {
  if (symbolicName.rfind(L"\\\\.\\", 0) == 0) return symbolicName;
  return L"\\\\.\\" + symbolicName;
}

std::wstring queryName(HANDLE hub, ULONG ioctl, ULONG index, bool connection) {
  // Hub symbolic names are bounded well below this buffer by Windows.
  constexpr ULONG bytes = 4096;
  std::vector<char> buffer(bytes, 0);
  for (int attempt = 0; attempt < 3; ++attempt) {
    DWORD returned = 0;
    BOOL ok = DeviceIoControl(hub, ioctl, connection ? &index : nullptr,
        connection ? sizeof(index) : 0, buffer.data(),
        static_cast<DWORD>(buffer.size()), &returned, nullptr);
    if (ok) {
      if (connection) {
        return reinterpret_cast<USB_NODE_CONNECTION_NAME*>(buffer.data())->NodeName;
      }
      return reinterpret_cast<USB_ROOT_HUB_NAME*>(buffer.data())->RootHubName;
    }
    if (GetLastError() != ERROR_INSUFFICIENT_BUFFER || buffer.size() < sizeof(ULONG)) break;
    ULONG required = *reinterpret_cast<ULONG*>(buffer.data());
    if (required <= buffer.size() || required > 64 * 1024) break;
    buffer.assign(required, 0);
  }
  return {};
}

std::wstring queryRootHub(HANDLE controller) {
  return queryName(controller, IOCTL_USB_GET_ROOT_HUB_NAME, 0, false);
}

std::vector<unsigned char> queryDescriptor(HANDLE hub, ULONG port,
    UCHAR descriptorType, UCHAR descriptorIndex, USHORT languageId,
    USHORT length) {
  const size_t requestSize = sizeof(USB_DESCRIPTOR_REQUEST) + length;
  std::vector<unsigned char> buffer(requestSize, 0);
  auto* request = reinterpret_cast<USB_DESCRIPTOR_REQUEST*>(buffer.data());
  request->ConnectionIndex = port;
  request->SetupPacket.bmRequest = 0x80;
  request->SetupPacket.bRequest = 0x06;
  request->SetupPacket.wValue = static_cast<USHORT>((descriptorType << 8) | descriptorIndex);
  request->SetupPacket.wIndex = languageId;
  request->SetupPacket.wLength = length;
  DWORD returned = 0;
  if (!DeviceIoControl(hub, IOCTL_USB_GET_DESCRIPTOR_FROM_NODE_CONNECTION,
      request, static_cast<DWORD>(requestSize), request,
      static_cast<DWORD>(requestSize), &returned, nullptr)) return {};
  const size_t descriptorOffset = sizeof(USB_DESCRIPTOR_REQUEST);
  const auto* descriptor = buffer.data() + descriptorOffset;
  if (returned <= descriptorOffset || descriptor[0] < 2) return {};
  size_t descriptorLength = std::min<size_t>(length, returned - descriptorOffset);
  if (descriptorType == 0x03) descriptorLength = std::min<size_t>(descriptorLength, descriptor[0]);
  if (descriptorLength < 2) return {};
  buffer.resize(descriptorOffset + descriptorLength);
  return std::vector<unsigned char>(buffer.begin() + descriptorOffset, buffer.end());
}

std::string hexBytes(const unsigned char* bytes, size_t length) {
  const char* digits = "0123456789ABCDEF";
  std::string out;
  out.reserve(length * 2);
  for (size_t i = 0; i < length; ++i) {
    out.push_back(digits[bytes[i] >> 4]);
    out.push_back(digits[bytes[i] & 0x0f]);
  }
  return out;
}

std::string stringDescriptor(HANDLE hub, ULONG port, UCHAR index, USHORT language) {
  if (!index) return {};
  const auto descriptor = queryDescriptor(hub, port, 0x03, index, language, 255);
  if (descriptor.size() < 2 || descriptor[1] != 0x03) return {};
  std::wstring value;
  for (size_t i = 2; i + 1 < descriptor.size(); i += 2) {
    value.push_back(static_cast<wchar_t>(descriptor[i] | (descriptor[i + 1] << 8)));
  }
  return utf8(value);
}

struct Topology {
  DWORD count = 0;

  std::string hub(HANDLE hubHandle, const std::wstring& name, unsigned depth) {
    std::ostringstream out;
    if (depth > kMaxDepth || count++ >= kMaxNodes) {
      return "{\"type\":\"hub\",\"name\":" + json(utf8(name)) +
          ",\"ports\":[],\"error\":\"topologyLimitExceeded\"}";
    }
    USB_NODE_INFORMATION info{};
    info.NodeType = UsbHub;
    DWORD returned = 0;
    if (!DeviceIoControl(hubHandle, IOCTL_USB_GET_NODE_INFORMATION, &info,
        sizeof(info), &info, sizeof(info), &returned, nullptr)) {
      return "{\"type\":\"hub\",\"name\":" + json(utf8(name)) +
          ",\"ports\":[],\"error\":\"hubInformationUnavailable\"}";
    }

    out << "{\"type\":\"hub\",\"name\":" << json(depth == 0 ? "Root Hub" : "External Hub")
        << ",\"symbolicLink\":" << json(utf8(name))
        << ",\"portCount\":" << static_cast<unsigned>(info.u.HubInformation.HubDescriptor.bNumberOfPorts)
        << ",\"hubCharacteristics\":" << info.u.HubInformation.HubDescriptor.wHubCharacteristics
        << ",\"powerOnToPowerGood\":" << static_cast<unsigned>(info.u.HubInformation.HubDescriptor.bPowerOnToPowerGood)
        << ",\"hubControlCurrent\":" << static_cast<unsigned>(info.u.HubInformation.HubDescriptor.bHubControlCurrent)
        << ",\"ports\":[";
    const ULONG portCount = info.u.HubInformation.HubDescriptor.bNumberOfPorts;
    for (ULONG port = 1; port <= portCount; ++port) {
      if (port > 1) out << ',';
      out << portNode(hubHandle, port, depth + 1);
    }
    out << "]}";
    return out.str();
  }

  std::string portNode(HANDLE hubHandle, ULONG port, unsigned depth) {
    std::ostringstream out;
    if (count++ >= kMaxNodes) {
      return "{\"type\":\"port\",\"port\":" + std::to_string(port) +
          ",\"status\":\"unknown\",\"error\":\"topologyLimitExceeded\",\"children\":[]}";
    }
    std::vector<char> infoBuffer(sizeof(USB_NODE_CONNECTION_INFORMATION_EX) + 4096, 0);
    auto* info = reinterpret_cast<USB_NODE_CONNECTION_INFORMATION_EX*>(infoBuffer.data());
    info->ConnectionIndex = port;
    DWORD returned = 0;
    if (!DeviceIoControl(hubHandle, IOCTL_USB_GET_NODE_CONNECTION_INFORMATION_EX,
        info, static_cast<DWORD>(sizeof(*info)), info,
        static_cast<DWORD>(infoBuffer.size()), &returned, nullptr)) {
      out << "{\"type\":\"port\",\"port\":" << port
          << ",\"status\":\"unknown\",\"error\":\"portQueryFailed\",\"children\":[]}";
      return out.str();
    }

    out << "{\"type\":\"port\",\"port\":" << port << ",\"status\":"
        << json(connectionStatusName(info->ConnectionStatus))
        << ",\"connectionStatusCode\":" << static_cast<unsigned>(info->ConnectionStatus);

    USB_NODE_CONNECTION_INFORMATION_EX_V2 connectionV2{};
    connectionV2.ConnectionIndex = port;
    connectionV2.Length = sizeof(connectionV2);
    connectionV2.SupportedUsbProtocols.ul = 0x7;
    DWORD v2Returned = 0;
    if (DeviceIoControl(hubHandle, IOCTL_USB_GET_NODE_CONNECTION_INFORMATION_EX_V2,
        &connectionV2, sizeof(connectionV2), &connectionV2,
        sizeof(connectionV2), &v2Returned, nullptr)) {
      out << ",\"supportedUsbProtocols\":" << connectionV2.SupportedUsbProtocols.ul
          << ",\"superSpeedOperating\":" << (connectionV2.Flags.DeviceIsOperatingAtSuperSpeedOrHigher ? "true" : "false")
          << ",\"superSpeedCapable\":" << (connectionV2.Flags.DeviceIsSuperSpeedCapableOrHigher ? "true" : "false")
          << ",\"superSpeedPlusOperating\":" << (connectionV2.Flags.DeviceIsOperatingAtSuperSpeedPlusOrHigher ? "true" : "false")
          << ",\"superSpeedPlusCapable\":" << (connectionV2.Flags.DeviceIsSuperSpeedPlusCapableOrHigher ? "true" : "false");
    }

    std::vector<unsigned char> connectorBuffer(4096, 0);
    auto* connector = reinterpret_cast<USB_PORT_CONNECTOR_PROPERTIES*>(connectorBuffer.data());
    connector->ConnectionIndex = port;
    DWORD connectorReturned = 0;
    if (DeviceIoControl(hubHandle, IOCTL_USB_GET_PORT_CONNECTOR_PROPERTIES,
        connector, static_cast<DWORD>(connectorBuffer.size()), connector,
        static_cast<DWORD>(connectorBuffer.size()), &connectorReturned, nullptr)) {
      out << ",\"portIsUserConnectable\":" << (connector->UsbPortProperties.PortIsUserConnectable ? "true" : "false")
          << ",\"portIsDebugCapable\":" << (connector->UsbPortProperties.PortIsDebugCapable ? "true" : "false")
          << ",\"portHasMultipleCompanions\":" << (connector->UsbPortProperties.PortHasMultipleCompanions ? "true" : "false")
          << ",\"portConnectorIsTypeC\":" << (connector->UsbPortProperties.PortConnectorIsTypeC ? "true" : "false")
          << ",\"companionPortNumber\":" << connector->CompanionPortNumber
          << ",\"companionHub\":" << json(utf8(connector->CompanionHubSymbolicLinkName));
      out << ",\"companions\":[";
      bool firstCompanion = true;
      for (USHORT companionIndex = 0; companionIndex < 8; ++companionIndex) {
        std::vector<unsigned char> companionBuffer(4096, 0);
        auto* companion = reinterpret_cast<USB_PORT_CONNECTOR_PROPERTIES*>(companionBuffer.data());
        companion->ConnectionIndex = port;
        companion->CompanionIndex = companionIndex;
        DWORD companionReturned = 0;
        if (!DeviceIoControl(hubHandle, IOCTL_USB_GET_PORT_CONNECTOR_PROPERTIES,
            companion, static_cast<DWORD>(companionBuffer.size()), companion,
            static_cast<DWORD>(companionBuffer.size()), &companionReturned, nullptr) ||
            companion->CompanionPortNumber == 0) break;
        if (!firstCompanion) out << ',';
        firstCompanion = false;
        out << "{\"index\":" << companionIndex
            << ",\"portNumber\":" << companion->CompanionPortNumber
            << ",\"hub\":" << json(utf8(companion->CompanionHubSymbolicLinkName)) << '}';
      }
      out << ']';
    }
    out << ",\"children\":[";
    if (info->ConnectionStatus == DeviceConnected) {
      out << "{\"type\":\"device\",\"name\":\"USB device\",\"status\":\"connected\","
          << "\"vendorId\":" << info->DeviceDescriptor.idVendor
          << ",\"productId\":" << info->DeviceDescriptor.idProduct
          << ",\"deviceClass\":" << static_cast<unsigned>(info->DeviceDescriptor.bDeviceClass)
          << ",\"deviceSubClass\":" << static_cast<unsigned>(info->DeviceDescriptor.bDeviceSubClass)
          << ",\"deviceProtocol\":" << static_cast<unsigned>(info->DeviceDescriptor.bDeviceProtocol)
          << ",\"speed\":" << json(speedName(static_cast<USB_DEVICE_SPEED>(info->Speed)))
          << ",\"usbVersion\":" << info->DeviceDescriptor.bcdUSB
          << ",\"deviceVersion\":" << info->DeviceDescriptor.bcdDevice
          << ",\"maxPacketSize0\":" << static_cast<unsigned>(info->DeviceDescriptor.bMaxPacketSize0)
          << ",\"configurationCount\":" << static_cast<unsigned>(info->DeviceDescriptor.bNumConfigurations)
          << ",\"deviceAddress\":" << static_cast<unsigned>(info->DeviceAddress)
          << ",\"openPipeCount\":" << info->NumberOfOpenPipes
          << ",\"currentConfigurationValue\":" << static_cast<unsigned>(info->CurrentConfigurationValue)
          << ",\"deviceIsHub\":" << (info->DeviceIsHub ? "true" : "false")
          << ",\"deviceDescriptorHex\":";
      const auto deviceDescriptor = queryDescriptor(hubHandle, port, 0x01, 0, 0, 18);
      out << json(deviceDescriptor.empty() ? std::string() : hexBytes(deviceDescriptor.data(), deviceDescriptor.size()));

      USHORT languageId = 0x0409;
      const auto languages = queryDescriptor(hubHandle, port, 0x03, 0, 0, 255);
      std::vector<USHORT> languageIds;
      if (languages.size() >= 4 && languages[1] == 0x03) {
        languageId = static_cast<USHORT>(languages[2] | (languages[3] << 8));
        for (size_t languageOffset = 2; languageOffset + 1 < languages.size() &&
            languageIds.size() < 8; languageOffset += 2) {
          languageIds.push_back(static_cast<USHORT>(languages[languageOffset] |
              (languages[languageOffset + 1] << 8)));
        }
      }
      const auto manufacturer = stringDescriptor(hubHandle, port,
          info->DeviceDescriptor.iManufacturer, languageId);
      const auto product = stringDescriptor(hubHandle, port,
          info->DeviceDescriptor.iProduct, languageId);
      const auto serial = stringDescriptor(hubHandle, port,
          info->DeviceDescriptor.iSerialNumber, languageId);
      const auto driverKeyName = queryDriverKeyName(hubHandle, port);
      const auto pnpProperties = queryPnpProperties(driverKeyName, !info->DeviceIsHub);
      out << ",\"manufacturer\":" << json(manufacturer)
          << ",\"product\":" << json(product)
          << ",\"serialNumber\":" << json(serial)
          << ",\"driverKeyName\":" << json(utf8(driverKeyName))
          << ",\"pnpProperties\":" << pnpJson(pnpProperties.properties)
          << ",\"serialPorts\":" << serialPortsJson(pnpProperties.serialPorts)
          << ",\"stringDescriptors\":[";
      bool firstString = true;
      for (const USHORT lang : languageIds) {
        for (UCHAR stringIndex = 1; stringIndex < 32; ++stringIndex) {
          const auto value = stringDescriptor(hubHandle, port, stringIndex, lang);
          if (value.empty()) continue;
          if (!firstString) out << ',';
          firstString = false;
          out << "{\"index\":" << static_cast<unsigned>(stringIndex)
              << ",\"languageId\":" << lang << ",\"value\":" << json(value) << '}';
        }
      }
      out << "],\"configurationDescriptors\":[";
      bool firstConfig = true;
      for (UCHAR descriptorIndex = 0;
          descriptorIndex < info->DeviceDescriptor.bNumConfigurations; ++descriptorIndex) {
        const auto header = queryDescriptor(hubHandle, port, 0x02, descriptorIndex, 0, 9);
        if (header.size() < 9 || header[1] != 0x02) continue;
        const USHORT totalLength = static_cast<USHORT>(header[2] | (header[3] << 8));
        if (totalLength < 9 || totalLength > 65535) continue;
        const auto config = queryDescriptor(hubHandle, port, 0x02, descriptorIndex, 0, totalLength);
        if (config.empty()) continue;
        if (!firstConfig) out << ',';
        firstConfig = false;
        out << "{\"index\":" << static_cast<unsigned>(descriptorIndex)
            << ",\"value\":" << static_cast<unsigned>(config[5])
            << ",\"interfaceCount\":" << static_cast<unsigned>(config[4])
            << ",\"attributes\":" << static_cast<unsigned>(config[7])
            << ",\"stringIndex\":" << static_cast<unsigned>(config[6])
            << ",\"maxPower\":" << static_cast<unsigned>(config[8])
            << ",\"descriptorHex\":" << json(hexBytes(config.data(), config.size()))
            << ",\"descriptors\":[";
        bool firstEntry = true;
        unsigned currentInterfaceClass = 0;
        unsigned currentInterfaceSubClass = 0;
        for (size_t offset = 0; offset + 2 <= config.size();) {
          const unsigned length = config[offset];
          const unsigned type = config[offset + 1];
          if (length < 2 || offset + length > config.size()) break;
          if (!firstEntry) out << ',';
          firstEntry = false;
          out << "{\"type\":" << type << ",\"length\":" << length
              << ",\"rawHex\":" << json(hexBytes(config.data() + offset, length));
          if (type == 0x04 && length >= 9) {
            currentInterfaceClass = config[offset + 5];
            currentInterfaceSubClass = config[offset + 6];
            out << ",\"interfaceNumber\":" << static_cast<unsigned>(config[offset + 2])
                << ",\"alternateSetting\":" << static_cast<unsigned>(config[offset + 3])
                << ",\"endpointCount\":" << static_cast<unsigned>(config[offset + 4])
                << ",\"class\":" << static_cast<unsigned>(config[offset + 5])
                << ",\"subclass\":" << static_cast<unsigned>(config[offset + 6])
                << ",\"protocol\":" << static_cast<unsigned>(config[offset + 7])
                << ",\"stringIndex\":" << static_cast<unsigned>(config[offset + 8]);
          } else if (type == 0x05 && length >= 7) {
            const unsigned packetSize = config[offset + 4] | (config[offset + 5] << 8);
            const unsigned endpointAttributes = config[offset + 3];
            const char* transferType = (endpointAttributes & 0x03) == 0 ? "Control" :
                (endpointAttributes & 0x03) == 1 ? "Isochronous" :
                (endpointAttributes & 0x03) == 2 ? "Bulk" : "Interrupt";
            out << ",\"endpointAddress\":" << static_cast<unsigned>(config[offset + 2])
                << ",\"attributes\":" << endpointAttributes
                << ",\"transferType\":" << json(transferType)
                << ",\"direction\":" << json((config[offset + 2] & 0x80) ? "IN" : "OUT")
                << ",\"maxPacketSize\":" << packetSize
                << ",\"interval\":" << static_cast<unsigned>(config[offset + 6]);
          } else if ((type == 0x24 || type == 0x25) && length >= 3) {
            out << ",\"interfaceClass\":" << currentInterfaceClass
                << ",\"interfaceSubClass\":" << currentInterfaceSubClass
                << ",\"subtype\":" << static_cast<unsigned>(config[offset + 2]);
          } else if (type == 0x21 && currentInterfaceClass == 0x03) {
            out << ",\"interfaceClass\":" << currentInterfaceClass
                << ",\"interfaceSubClass\":" << currentInterfaceSubClass;
          }
          out << '}';
          offset += length;
        }
        out << "]}";
      }
      out << "],\"bosDescriptorHex\":";
      const auto bosHeader = queryDescriptor(hubHandle, port, 0x0f, 0, 0, 5);
      if (bosHeader.size() >= 5 && bosHeader[1] == 0x0f) {
        const USHORT bosLength = static_cast<USHORT>(bosHeader[2] | (bosHeader[3] << 8));
        const auto bos = bosLength >= 5 && bosLength <= 65535
            ? queryDescriptor(hubHandle, port, 0x0f, 0, 0, bosLength)
            : std::vector<unsigned char>();
        out << json(bos.empty() ? std::string() : hexBytes(bos.data(), bos.size()));
      } else {
        out << "\"\"";
      }

      if (info->DeviceIsHub && depth >= kMaxDepth) {
        out << ",\"hubError\":\"hubDepthExceeded\"";
      } else if (info->DeviceIsHub) {
        const std::wstring childName = queryName(hubHandle,
            IOCTL_USB_GET_NODE_CONNECTION_NAME, port, true);
        if (!childName.empty()) {
          const std::wstring childPath = hubDevicePath(childName);
          Handle child(CreateFileW(childPath.c_str(), GENERIC_WRITE, FILE_SHARE_WRITE,
              nullptr, OPEN_EXISTING, 0, nullptr));
          if (child.value != INVALID_HANDLE_VALUE) {
            out << ",\"children\":[" << hub(child.value, childName, depth + 1) << ']';
          } else {
            out << ",\"hubError\":\"childHubOpenFailed\"";
          }
        } else {
          out << ",\"hubError\":\"childHubNameUnavailable\"";
        }
      } else {
        out << ",\"children\":" << pnpProperties.childrenJson;
      }
      out << '}';
    }
    out << "]}";
    return out.str();
  }
};

std::string controllerNode(const std::wstring& path, DWORD index) {
  std::ostringstream out;
  out << "{\"type\":\"controller\",\"name\":\"USB Host Controller "
      << (index + 1) << "\",\"controllerIndex\":" << index;
  Handle controller(CreateFileW(path.c_str(), GENERIC_WRITE, FILE_SHARE_WRITE,
      nullptr, OPEN_EXISTING, 0, nullptr));
  if (controller.value == INVALID_HANDLE_VALUE) {
    out << ",\"children\":[],\"error\":\"controllerOpenFailed\"}";
    return out.str();
  }
  const std::wstring rootName = queryRootHub(controller.value);
  if (rootName.empty()) {
    out << ",\"children\":[],\"error\":\"rootHubUnavailable\"}";
    return out.str();
  }
  const std::wstring rootPath = hubDevicePath(rootName);
  Handle root(CreateFileW(rootPath.c_str(), GENERIC_WRITE, FILE_SHARE_WRITE,
      nullptr, OPEN_EXISTING, 0, nullptr));
  if (root.value == INVALID_HANDLE_VALUE) {
    out << ",\"children\":[],\"error\":\"rootHubOpenFailed\",\"win32Error\":"
        << GetLastError() << '}';
    return out.str();
  }
  const auto driverKeyName = queryControllerDriverKeyName(controller.value);
  const auto pnpProperties = queryPnpProperties(driverKeyName, false);
  Topology topology;
  out << ",\"driverKeyName\":" << json(utf8(driverKeyName))
      << ",\"pnpProperties\":" << pnpJson(pnpProperties.properties)
      << ",\"children\":[" << topology.hub(root.value, rootName, 0) << "]}";
  return out.str();
}

std::wstring devnodeString(DEVINST devnode, ULONG property) {
  std::vector<wchar_t> buffer(32768, L'\0');
  ULONG type = 0;
  ULONG bytes = static_cast<ULONG>(buffer.size() * sizeof(wchar_t));
  if (CM_Get_DevNode_Registry_PropertyW(devnode, property, &type,
      buffer.data(), &bytes, 0) != CR_SUCCESS || type != REG_SZ) return {};
  return buffer.data();
}

std::wstring devnodeMultiString(DEVINST devnode, ULONG property) {
  std::vector<wchar_t> buffer(32768, L'\0');
  ULONG type = 0;
  ULONG bytes = static_cast<ULONG>(buffer.size() * sizeof(wchar_t));
  if (CM_Get_DevNode_Registry_PropertyW(devnode, property, &type,
      buffer.data(), &bytes, 0) != CR_SUCCESS || type != REG_MULTI_SZ) return {};
  std::wstring joined;
  for (const wchar_t* item = buffer.data(); *item; item += wcslen(item) + 1) {
    if (!joined.empty()) joined += L" | ";
    joined += item;
  }
  return joined;
}

std::wstring devnodeInstanceId(DEVINST devnode) {
  ULONG chars = 0;
  if (CM_Get_Device_ID_Size(&chars, devnode, 0) != CR_SUCCESS || chars >= 32768) return {};
  std::vector<wchar_t> buffer(chars + 1, L'\0');
  if (CM_Get_Device_IDW(devnode, buffer.data(), static_cast<ULONG>(buffer.size()),
      0) != CR_SUCCESS) return {};
  return buffer.data();
}

std::string interfacePathsForInstance(const std::string& instanceId) {
  if (instanceId.empty()) return {};
  auto key = [](std::string value) {
    std::transform(value.begin(), value.end(), value.begin(), [](unsigned char ch) {
      return static_cast<char>(std::tolower(ch));
    });
    return value;
  };
  static const auto paths = [&key]() {
    std::map<std::string, std::set<std::string>> found;
    DeviceInfoSet devices(SetupDiGetClassDevsW(nullptr, nullptr, nullptr,
        DIGCF_ALLCLASSES | DIGCF_PRESENT | DIGCF_DEVICEINTERFACE));
    if (devices.value == INVALID_HANDLE_VALUE) return found;
    unsigned totalInterfaces = 0;
    for (ULONG classIndex = 0; classIndex < 1024 && totalInterfaces < 16384;
        ++classIndex) {
      GUID classGuid{};
      const CONFIGRET status = CM_Enumerate_Classes(classIndex, &classGuid,
          CM_ENUMERATE_CLASSES_INTERFACE);
      if (status == CR_NO_SUCH_VALUE) break;
      if (status != CR_SUCCESS) continue;
      for (DWORD index = 0; index < 4096 && totalInterfaces < 16384; ++index) {
        SP_DEVICE_INTERFACE_DATA interfaceData{};
        interfaceData.cbSize = sizeof(interfaceData);
        if (!SetupDiEnumDeviceInterfaces(devices.value, nullptr, &classGuid,
            index, &interfaceData)) {
          if (GetLastError() == ERROR_NO_MORE_ITEMS) break;
          continue;
        }
        ++totalInterfaces;
        DWORD required = 0;
        SetupDiGetDeviceInterfaceDetailW(devices.value, &interfaceData,
            nullptr, 0, &required, nullptr);
        if (!required || required > 64 * 1024) continue;
        std::vector<char> buffer(required, 0);
        auto* detail = reinterpret_cast<SP_DEVICE_INTERFACE_DETAIL_DATA_W*>(buffer.data());
        detail->cbSize = sizeof(SP_DEVICE_INTERFACE_DETAIL_DATA_W);
        SP_DEVINFO_DATA device{};
        device.cbSize = sizeof(device);
        if (!SetupDiGetDeviceInterfaceDetailW(devices.value, &interfaceData,
            detail, required, nullptr, &device)) continue;
        const auto id = utf8(devnodeInstanceId(device.DevInst));
        if (!id.empty() && found[key(id)].size() < 16) {
          found[key(id)].insert(utf8(detail->DevicePath));
        }
      }
    }
    return found;
  }();
  const auto it = paths.find(key(instanceId));
  if (it == paths.end()) return {};
  std::string joined;
  for (const auto& path : it->second) {
    if (!joined.empty()) joined += " | ";
    joined += path;
  }
  return joined;
}

std::string usb4Devnode(DEVINST devnode, DWORD controllerIndex,
    unsigned depth, unsigned& count) {
  const bool controller = depth == 0;
  const std::wstring name = devnodeString(devnode, CM_DRP_FRIENDLYNAME);
  const std::wstring description = name.empty()
      ? devnodeString(devnode, CM_DRP_DEVICEDESC) : name;
  const std::wstring driverKey = devnodeString(devnode, CM_DRP_DRIVER);
  std::ostringstream out;
  out << "{\"type\":" << json(controller ? "controller" : "pnpDevice")
      << ",\"name\":" << json(utf8(description.empty() ? L"USB4 device" : description))
      << ",\"instanceId\":" << json(utf8(devnodeInstanceId(devnode)));
  if (controller) out << ",\"controllerIndex\":" << controllerIndex;
  if (depth >= 8 || count++ >= 256) {
    out << ",\"children\":[],\"error\":\"topologyLimitExceeded\"}";
    return out.str();
  }
  auto pnp = queryPnpProperties(driverKey, false);
  if (!pnp.properties.count("instanceId")) {
    pnp.properties["instanceId"] = utf8(devnodeInstanceId(devnode));
  }
  if (!pnp.properties.count("deviceInterfacePaths")) {
    const auto paths = interfacePathsForInstance(pnp.properties["instanceId"]);
    if (!paths.empty()) pnp.properties["deviceInterfacePaths"] = paths;
  }
  if (!pnp.properties.count("powerState")) {
    CM_POWER_DATA powerData{};
    ULONG powerType = 0;
    ULONG bytes = sizeof(powerData);
    if (CM_Get_DevNode_Registry_PropertyW(devnode, CM_DRP_DEVICE_POWER_DATA,
        &powerType, &powerData, &bytes, 0) == CR_SUCCESS &&
        powerType == REG_BINARY &&
        bytes >= offsetof(CM_POWER_DATA, PD_MostRecentPowerState) +
            sizeof(powerData.PD_MostRecentPowerState) &&
        powerData.PD_MostRecentPowerState >= PowerDeviceD0 &&
        powerData.PD_MostRecentPowerState <= PowerDeviceD3) {
      pnp.properties["powerState"] = "D" + std::to_string(
          powerData.PD_MostRecentPowerState - PowerDeviceD0);
    }
  }
  out << ",\"pnpProperties\":" << pnpJson(pnp.properties) << ",\"children\":[";
  DEVINST child = 0;
  if (CM_Get_Child(&child, devnode, 0) == CR_SUCCESS) {
    bool first = true;
    for (unsigned sibling = 0; sibling < 256 && child; ++sibling) {
      if (!first) out << ',';
      first = false;
      out << usb4Devnode(child, controllerIndex, depth + 1, count);
      DEVINST next = 0;
      if (CM_Get_Sibling(&next, child, 0) != CR_SUCCESS) break;
      child = next;
    }
  }
  out << "]}";
  return out.str();
}

std::string enumerateControllers(int selectedIndex = -1, bool listOnly = false) {
  DeviceInfoSet devices(SetupDiGetClassDevsW(&GUID_DEVINTERFACE_USB_HOST_CONTROLLER,
      nullptr, nullptr, DIGCF_PRESENT | DIGCF_DEVICEINTERFACE));
  if (devices.value == INVALID_HANDLE_VALUE) {
    return "{\"version\":1,\"controllers\":[],\"error\":\"controllerEnumerationFailed\"}";
  }
  std::ostringstream out;
  out << "{\"version\":1,\"controllers\":[";
  bool first = true;
  DWORD usbControllerCount = 0;
  for (DWORD index = 0; index < 256; ++index) {
    SP_DEVICE_INTERFACE_DATA interfaceData{};
    interfaceData.cbSize = sizeof(interfaceData);
    if (!SetupDiEnumDeviceInterfaces(devices.value, nullptr,
        &GUID_DEVINTERFACE_USB_HOST_CONTROLLER, index, &interfaceData)) {
      if (GetLastError() == ERROR_NO_MORE_ITEMS) break;
      continue;
    }
    usbControllerCount = index + 1;
    DWORD required = 0;
    SetupDiGetDeviceInterfaceDetailW(devices.value, &interfaceData, nullptr, 0,
        &required, nullptr);
    if (!required || required > 64 * 1024) continue;
    std::vector<char> detailBuffer(required, 0);
    auto* detail = reinterpret_cast<SP_DEVICE_INTERFACE_DETAIL_DATA_W*>(detailBuffer.data());
    detail->cbSize = sizeof(SP_DEVICE_INTERFACE_DETAIL_DATA_W);
    if (!SetupDiGetDeviceInterfaceDetailW(devices.value, &interfaceData, detail,
        required, nullptr, nullptr)) continue;
    if (selectedIndex >= 0 && index != static_cast<DWORD>(selectedIndex)) continue;
    if (!first) out << ',';
    first = false;
    if (listOnly) {
      out << "{\"type\":\"controller\",\"name\":\"USB Host Controller "
          << (index + 1) << "\",\"controllerIndex\":" << index << ",\"children\":[]}";
    } else {
      out << controllerNode(detail->DevicePath, index);
    }
  }
  DeviceInfoSet pnpDevices(SetupDiGetClassDevsW(nullptr, nullptr, nullptr,
      DIGCF_ALLCLASSES | DIGCF_PRESENT));
  if (pnpDevices.value != INVALID_HANDLE_VALUE) {
    DWORD usb4Count = 0;
    for (DWORD index = 0; index < 65536; ++index) {
      SP_DEVINFO_DATA device{};
      device.cbSize = sizeof(device);
      if (!SetupDiEnumDeviceInfo(pnpDevices.value, index, &device)) break;
      const std::wstring service = devnodeString(device.DevInst, CM_DRP_SERVICE);
      if (_wcsicmp(service.c_str(), L"Usb4HostRouter") != 0) continue;
      const DWORD controllerIndex = usbControllerCount + usb4Count++;
      if (controllerIndex > 255) break;
      if (selectedIndex >= 0 && controllerIndex != static_cast<DWORD>(selectedIndex)) continue;
      if (!first) out << ',';
      first = false;
      if (listOnly) {
        out << "{\"type\":\"controller\",\"name\":\"USB4 Host Router\",\"controllerIndex\":"
            << controllerIndex << ",\"children\":[]}";
      } else {
        unsigned count = 0;
        out << usb4Devnode(device.DevInst, controllerIndex, 0, count);
      }
    }
  }
  out << "]}";
  return out.str();
}

DWORD CALLBACK onUsbDeviceChange(HCMNOTIFICATION, PVOID context,
    CM_NOTIFY_ACTION action, PCM_NOTIFY_EVENT_DATA, DWORD) {
  if (action == CM_NOTIFY_ACTION_DEVICEINTERFACEARRIVAL ||
      action == CM_NOTIFY_ACTION_DEVICEINTERFACEREMOVAL) {
    SetEvent(static_cast<HANDLE>(context));
  }
  return ERROR_SUCCESS;
}

int watchUsbDevices() {
  Handle changed(CreateEventW(nullptr, FALSE, FALSE, nullptr));
  if (changed.value == INVALID_HANDLE_VALUE || !changed.value) return 5;
  const GUID classes[] = {GUID_DEVINTERFACE_USB_DEVICE,
      GUID_DEVINTERFACE_USB_HUB, GUID_DEVINTERFACE_USB_HOST_CONTROLLER};
  std::vector<HCMNOTIFICATION> registrations;
  for (const GUID& interfaceClass : classes) {
    CM_NOTIFY_FILTER filter{};
    filter.cbSize = sizeof(filter);
    filter.FilterType = CM_NOTIFY_FILTER_TYPE_DEVICEINTERFACE;
    filter.u.DeviceInterface.ClassGuid = interfaceClass;
    HCMNOTIFICATION registration = nullptr;
    if (CM_Register_Notification(&filter, changed.value, onUsbDeviceChange,
        &registration) == CR_SUCCESS) registrations.push_back(registration);
  }
  if (registrations.empty()) return 5;
  HANDLE output = GetStdHandle(STD_OUTPUT_HANDLE);
  DWORD written = 0;
  bool okay = output != INVALID_HANDLE_VALUE &&
      WriteFile(output, "ready\n", 6, &written, nullptr) && written == 6;
  while (okay && WaitForSingleObject(changed.value, INFINITE) == WAIT_OBJECT_0) {
    okay = WriteFile(output, "changed\n", 8, &written, nullptr) && written == 8;
  }
  for (HCMNOTIFICATION registration : registrations) CM_Unregister_Notification(registration);
  return okay ? 0 : 6;
}

}  // namespace

int wmain(int argc, wchar_t* argv[]) {
  if (argc == 2 && wcscmp(argv[1], L"--watch") == 0) return watchUsbDevices();
  bool listOnly = argc == 2 && wcscmp(argv[1], L"--list") == 0;
  int selectedIndex = -1;
  if (argc == 3 && wcscmp(argv[1], L"--controller") == 0) {
    wchar_t* end = nullptr;
    unsigned long parsed = wcstoul(argv[2], &end, 10);
    if (!argv[2][0] || *end || parsed > 255) return 4;
    selectedIndex = static_cast<int>(parsed);
  } else if (!listOnly && !(argc == 1 || (argc == 2 && wcscmp(argv[1], L"--json") == 0))) {
    return 4;
  }
  const std::string output = enumerateControllers(selectedIndex, listOnly);
  const DWORD limit = 8 * 1024 * 1024;
  if (output.size() > limit) {
    std::cerr << "USB topology exceeds output limit.\n";
    return 2;
  }
  const std::string framed = output + '\n';
  DWORD written = 0;
  HANDLE stdoutHandle = GetStdHandle(STD_OUTPUT_HANDLE);
  if (stdoutHandle == INVALID_HANDLE_VALUE ||
      !WriteFile(stdoutHandle, framed.data(), static_cast<DWORD>(framed.size()),
          &written, nullptr) || written != framed.size()) return 3;
  return 0;
}
