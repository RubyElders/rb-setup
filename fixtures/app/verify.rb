require 'rake'
raise "Unexpected Ruby #{RUBY_VERSION}" unless RUBY_VERSION == '4.0.9'
raise "Unexpected Rake #{Rake::VERSION}" unless Rake::VERSION == '13.3.1'
puts "Ruby #{RUBY_VERSION}, Rake #{Rake::VERSION}"
