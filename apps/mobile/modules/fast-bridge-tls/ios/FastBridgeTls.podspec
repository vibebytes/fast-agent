require 'json'

package = JSON.parse(File.read(File.join(__dir__, '..', 'package.json')))

Pod::Spec.new do |s|
  s.name           = 'FastBridgeTls'
  s.version        = package['version']
  s.summary        = package['description']
  s.author         = { 'fast' => 'dev@fast.local' }
  s.homepage       = 'https://fast.local'
  s.license        = 'MIT'
  s.platforms      = { :ios => '15.1' }
  s.swift_version  = '5.9'
  s.source         = { :path => __dir__ }
  s.source_files   = '**/*.swift'
  s.dependency 'ExpoModulesCore'
end
