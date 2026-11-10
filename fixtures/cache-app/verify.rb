require 'rake'
require 'json'
require 'cache_path'
raise "Unexpected Ruby #{RUBY_VERSION}" unless RUBY_VERSION == '4.0.9'
raise "Unexpected Rake #{Rake::VERSION}" unless Rake::VERSION == '13.3.1'
raise "Unexpected JSON #{JSON::VERSION}" unless JSON::VERSION == '3.1.0'
raise 'Native JSON parser did not load' unless JSON::Parser == JSON::Ext::Parser
raise 'JSON parsing failed' unless JSON.parse('{"ready":true}') == { 'ready' => true }
raise 'Missing local source' unless CachePath::VALUE == ENV.fetch('EXPECTED_PATH', 'path')
puts "Ruby #{RUBY_VERSION}, Rake #{Rake::VERSION}, JSON #{JSON::VERSION}, Git rake, native JSON and path loaded"
