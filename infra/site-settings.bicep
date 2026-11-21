targetScope = 'resourceGroup'

// The site's settings, as a deployment of their own. A template reads keys as soon as the
// account that holds them exists, without waiting for anything else. Read from the main
// template, the model account's key was requested while the model deployment was being
// created on that account, and Azure refused it with RequestConflict. Here the keys are
// read only when this module starts, after everything it depends on has finished.

param siteName string
param storageName string
param visionName string = ''
param ocrName string = ''
param modelName string = ''
@secure()
param parentPassword string
@secure()
param childPassword string
param parentUsername string
param childUsername string
param taxMultiplier string
param monthlyAzureReserve string

var enableVision = !empty(visionName)

resource site 'Microsoft.Web/staticSites@2024-11-01' existing = {
  name: siteName
}

resource storage 'Microsoft.Storage/storageAccounts@2023-05-01' existing = {
  name: storageName
}

resource vision 'Microsoft.CognitiveServices/accounts@2024-10-01' existing = if (enableVision) {
  name: visionName
}

resource ocr 'Microsoft.CognitiveServices/accounts@2024-10-01' existing = if (enableVision) {
  name: ocrName
}

resource settings 'Microsoft.Web/staticSites/config@2024-11-01' = {
  parent: site
  name: 'appsettings'
  properties: union({
    NODE_ENV: 'production'
    PUBLIC_APP_ORIGIN: 'https://${site.properties.defaultHostname}'
    AZURE_STORAGE_CONNECTION_STRING: 'DefaultEndpointsProtocol=https;AccountName=${storage.name};AccountKey=${storage.listKeys().keys[0].value};EndpointSuffix=${environment().suffixes.storage}'
    BOOTSTRAP_PARENT_PASSWORD: parentPassword
    BOOTSTRAP_CHILD_PASSWORD: childPassword
    PARENT_USERNAME: parentUsername
    CHILD_USERNAME: childUsername
    TAX_MULTIPLIER: taxMultiplier
    AZURE_MONTHLY_RESERVE_USD: monthlyAzureReserve
  }, enableVision ? {
    AZURE_OPENAI_ENDPOINT: vision!.properties.endpoint
    AZURE_OPENAI_API_KEY: vision!.listKeys().key1
    AZURE_OPENAI_DEPLOYMENT: modelName
    AZURE_VISION_ENDPOINT: ocr!.properties.endpoint
    AZURE_VISION_KEY: ocr!.listKeys().key1
  } : {})
}
